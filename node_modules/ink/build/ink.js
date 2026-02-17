import process from 'node:process';
import React from 'react';
import { throttle } from 'es-toolkit/compat';
import ansiEscapes from 'ansi-escapes';
import isInCi from 'is-in-ci';
import autoBind from 'auto-bind';
import signalExit from 'signal-exit';
import patchConsole from 'patch-console';
import { LegacyRoot, ConcurrentRoot } from 'react-reconciler/constants.js';
import Yoga from 'yoga-layout';
import wrapAnsi from 'wrap-ansi';
import terminalSize from 'terminal-size';
import reconciler from './reconciler.js';
import render from './renderer.js';
import * as dom from './dom.js';
import logUpdate from './log-update.js';
import { bsu, esu, shouldSynchronize } from './write-synchronized.js';
import instances from './instances.js';
import App from './components/App.js';
import { accessibilityContext as AccessibilityContext } from './components/AccessibilityContext.js';
import { resolveFlags, } from './kitty-keyboard.js';
const noop = () => { };
export default class Ink {
    /**
    Whether this instance is using concurrent rendering mode.
    */
    isConcurrent;
    options;
    log;
    cursorPosition;
    throttledLog;
    isScreenReaderEnabled;
    // Ignore last render after unmounting a tree to prevent empty output before exit
    isUnmounted;
    lastOutput;
    lastOutputToRender;
    lastOutputHeight;
    lastTerminalWidth;
    container;
    rootNode;
    // This variable is used only in debug mode to store full static output
    // so that it's rerendered every time, not just new static parts, like in non-debug mode
    fullStaticOutput;
    exitPromise;
    beforeExitHandler;
    restoreConsole;
    unsubscribeResize;
    throttledOnRender;
    kittyProtocolEnabled = false;
    cancelKittyDetection;
    constructor(options) {
        autoBind(this);
        this.options = options;
        this.rootNode = dom.createNode('ink-root');
        this.rootNode.onComputeLayout = this.calculateLayout;
        this.isScreenReaderEnabled =
            options.isScreenReaderEnabled ??
                process.env['INK_SCREEN_READER'] === 'true';
        const unthrottled = options.debug || this.isScreenReaderEnabled;
        const maxFps = options.maxFps ?? 30;
        const renderThrottleMs = maxFps > 0 ? Math.max(1, Math.ceil(1000 / maxFps)) : 0;
        if (unthrottled) {
            this.rootNode.onRender = this.onRender;
            this.throttledOnRender = undefined;
        }
        else {
            const throttled = throttle(this.onRender, renderThrottleMs, {
                leading: true,
                trailing: true,
            });
            this.rootNode.onRender = throttled;
            this.throttledOnRender = throttled;
        }
        this.rootNode.onImmediateRender = this.onRender;
        this.log = logUpdate.create(options.stdout, {
            incremental: options.incrementalRendering,
        });
        this.cursorPosition = undefined;
        this.throttledLog = unthrottled
            ? this.log
            : throttle((output) => {
                const shouldWrite = this.log.willRender(output);
                const sync = shouldSynchronize(this.options.stdout);
                if (sync && shouldWrite) {
                    this.options.stdout.write(bsu);
                }
                this.log(output);
                if (sync && shouldWrite) {
                    this.options.stdout.write(esu);
                }
            }, undefined, {
                leading: true,
                trailing: true,
            });
        // Ignore last render after unmounting a tree to prevent empty output before exit
        this.isUnmounted = false;
        // Store concurrent mode setting
        this.isConcurrent = options.concurrent ?? false;
        // Store last output to only rerender when needed
        this.lastOutput = '';
        this.lastOutputToRender = '';
        this.lastOutputHeight = 0;
        this.lastTerminalWidth = this.getTerminalWidth();
        // This variable is used only in debug mode to store full static output
        // so that it's rerendered every time, not just new static parts, like in non-debug mode
        this.fullStaticOutput = '';
        // Use ConcurrentRoot for concurrent mode, LegacyRoot for legacy mode
        const rootTag = options.concurrent ? ConcurrentRoot : LegacyRoot;
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        this.container = reconciler.createContainer(this.rootNode, rootTag, null, false, null, 'id', () => { }, () => { }, () => { }, () => { });
        // Unmount when process exits
        this.unsubscribeExit = signalExit(this.unmount, { alwaysLast: false });
        if (process.env['DEV'] === 'true') {
            reconciler.injectIntoDevTools({
                bundleType: 0,
                // Reporting React DOM's version, not Ink's
                // See https://github.com/facebook/react/issues/16666#issuecomment-532639905
                version: '16.13.1',
                rendererPackageName: 'ink',
            });
        }
        if (options.patchConsole) {
            this.patchConsole();
        }
        if (!isInCi) {
            options.stdout.on('resize', this.resized);
            this.unsubscribeResize = () => {
                options.stdout.off('resize', this.resized);
            };
        }
        this.initKittyKeyboard();
    }
    getTerminalWidth = () => {
        // The 'columns' property can be undefined or 0 when not using a TTY.
        // Use terminal-size as a fallback for piped processes, then default to 80.
        if (this.options.stdout.columns) {
            return this.options.stdout.columns;
        }
        const size = terminalSize();
        return size?.columns ?? 80;
    };
    resized = () => {
        const currentWidth = this.getTerminalWidth();
        if (currentWidth < this.lastTerminalWidth) {
            // We clear the screen when decreasing terminal width to prevent duplicate overlapping re-renders.
            this.log.clear();
            this.lastOutput = '';
            this.lastOutputToRender = '';
        }
        this.calculateLayout();
        this.onRender();
        this.lastTerminalWidth = currentWidth;
    };
    resolveExitPromise = () => { };
    rejectExitPromise = () => { };
    unsubscribeExit = () => { };
    setCursorPosition = (position) => {
        this.cursorPosition = position;
        this.log.setCursorPosition(position);
    };
    restoreLastOutput = () => {
        // Clear() resets log-update's cursor state, so replay the latest cursor intent
        // before restoring output after external stdout/stderr writes.
        this.log.setCursorPosition(this.cursorPosition);
        this.log(this.lastOutputToRender || this.lastOutput + '\n');
    };
    calculateLayout = () => {
        const terminalWidth = this.getTerminalWidth();
        this.rootNode.yogaNode.setWidth(terminalWidth);
        this.rootNode.yogaNode.calculateLayout(undefined, undefined, Yoga.DIRECTION_LTR);
    };
    onRender = () => {
        if (this.isUnmounted) {
            return;
        }
        const startTime = performance.now();
        const { output, outputHeight, staticOutput } = render(this.rootNode, this.isScreenReaderEnabled);
        this.options.onRender?.({ renderTime: performance.now() - startTime });
        // If <Static> output isn't empty, it means new children have been added to it
        const hasStaticOutput = staticOutput && staticOutput !== '\n';
        if (this.options.debug) {
            if (hasStaticOutput) {
                this.fullStaticOutput += staticOutput;
            }
            this.options.stdout.write(this.fullStaticOutput + output);
            return;
        }
        if (isInCi) {
            if (hasStaticOutput) {
                this.options.stdout.write(staticOutput);
            }
            this.lastOutput = output;
            this.lastOutputToRender = output + '\n';
            this.lastOutputHeight = outputHeight;
            return;
        }
        if (this.isScreenReaderEnabled) {
            const sync = shouldSynchronize(this.options.stdout);
            if (sync) {
                this.options.stdout.write(bsu);
            }
            if (hasStaticOutput) {
                // We need to erase the main output before writing new static output
                const erase = this.lastOutputHeight > 0
                    ? ansiEscapes.eraseLines(this.lastOutputHeight)
                    : '';
                this.options.stdout.write(erase + staticOutput);
                // After erasing, the last output is gone, so we should reset its height
                this.lastOutputHeight = 0;
            }
            if (output === this.lastOutput && !hasStaticOutput) {
                if (sync) {
                    this.options.stdout.write(esu);
                }
                return;
            }
            const terminalWidth = this.getTerminalWidth();
            const wrappedOutput = wrapAnsi(output, terminalWidth, {
                trim: false,
                hard: true,
            });
            // If we haven't erased yet, do it now.
            if (hasStaticOutput) {
                this.options.stdout.write(wrappedOutput);
            }
            else {
                const erase = this.lastOutputHeight > 0
                    ? ansiEscapes.eraseLines(this.lastOutputHeight)
                    : '';
                this.options.stdout.write(erase + wrappedOutput);
            }
            this.lastOutput = output;
            this.lastOutputToRender = wrappedOutput;
            this.lastOutputHeight =
                wrappedOutput === '' ? 0 : wrappedOutput.split('\n').length;
            if (sync) {
                this.options.stdout.write(esu);
            }
            return;
        }
        if (hasStaticOutput) {
            this.fullStaticOutput += staticOutput;
        }
        // Detect fullscreen: output fills or exceeds terminal height.
        // Only apply when writing to a real TTY — piped output always gets trailing newlines.
        const isFullscreen = this.options.stdout.isTTY && outputHeight >= this.options.stdout.rows;
        const outputToRender = isFullscreen ? output : output + '\n';
        if (this.lastOutputHeight >= this.options.stdout.rows) {
            const sync = shouldSynchronize(this.options.stdout);
            if (sync) {
                this.options.stdout.write(bsu);
            }
            this.options.stdout.write(ansiEscapes.clearTerminal + this.fullStaticOutput + output);
            this.lastOutput = output;
            this.lastOutputToRender = outputToRender;
            this.lastOutputHeight = outputHeight;
            this.log.sync(outputToRender);
            if (sync) {
                this.options.stdout.write(esu);
            }
            return;
        }
        // To ensure static output is cleanly rendered before main output, clear main output first
        if (hasStaticOutput) {
            const sync = shouldSynchronize(this.options.stdout);
            if (sync) {
                this.options.stdout.write(bsu);
            }
            this.log.clear();
            this.options.stdout.write(staticOutput);
            this.log(outputToRender);
            if (sync) {
                this.options.stdout.write(esu);
            }
        }
        else if (output !== this.lastOutput || this.log.isCursorDirty()) {
            // ThrottledLog manages its own bsu/esu at actual write time
            this.throttledLog(outputToRender);
        }
        this.lastOutput = output;
        this.lastOutputToRender = outputToRender;
        this.lastOutputHeight = outputHeight;
    };
    render(node) {
        const tree = (React.createElement(AccessibilityContext.Provider, { value: { isScreenReaderEnabled: this.isScreenReaderEnabled } },
            React.createElement(App, { stdin: this.options.stdin, stdout: this.options.stdout, stderr: this.options.stderr, exitOnCtrlC: this.options.exitOnCtrlC, writeToStdout: this.writeToStdout, writeToStderr: this.writeToStderr, setCursorPosition: this.setCursorPosition, onExit: this.unmount }, node)));
        if (this.options.concurrent) {
            // Concurrent mode: use updateContainer (async scheduling)
            reconciler.updateContainer(tree, this.container, null, noop);
        }
        else {
            // Legacy mode: use updateContainerSync + flushSyncWork (sync)
            reconciler.updateContainerSync(tree, this.container, null, noop);
            reconciler.flushSyncWork();
        }
    }
    writeToStdout(data) {
        if (this.isUnmounted) {
            return;
        }
        if (this.options.debug) {
            this.options.stdout.write(data + this.fullStaticOutput + this.lastOutput);
            return;
        }
        if (isInCi) {
            this.options.stdout.write(data);
            return;
        }
        const sync = shouldSynchronize(this.options.stdout);
        if (sync) {
            this.options.stdout.write(bsu);
        }
        this.log.clear();
        this.options.stdout.write(data);
        this.restoreLastOutput();
        if (sync) {
            this.options.stdout.write(esu);
        }
    }
    writeToStderr(data) {
        if (this.isUnmounted) {
            return;
        }
        if (this.options.debug) {
            this.options.stderr.write(data);
            this.options.stdout.write(this.fullStaticOutput + this.lastOutput);
            return;
        }
        if (isInCi) {
            this.options.stderr.write(data);
            return;
        }
        const sync = shouldSynchronize(this.options.stdout);
        if (sync) {
            this.options.stdout.write(bsu);
        }
        this.log.clear();
        this.options.stderr.write(data);
        this.restoreLastOutput();
        if (sync) {
            this.options.stdout.write(esu);
        }
    }
    // eslint-disable-next-line @typescript-eslint/ban-types
    unmount(error) {
        if (this.isUnmounted) {
            return;
        }
        if (this.beforeExitHandler) {
            process.off('beforeExit', this.beforeExitHandler);
            this.beforeExitHandler = undefined;
        }
        // Flush any pending throttled render to ensure the final frame is rendered
        if (this.throttledOnRender) {
            this.throttledOnRender.flush();
        }
        this.calculateLayout();
        this.onRender();
        this.unsubscribeExit();
        if (typeof this.restoreConsole === 'function') {
            this.restoreConsole();
        }
        if (typeof this.unsubscribeResize === 'function') {
            this.unsubscribeResize();
        }
        // Flush any pending throttled log writes
        const throttledLog = this.throttledLog;
        if (typeof throttledLog.flush === 'function') {
            throttledLog.flush();
        }
        // Cancel any in-progress auto-detection before checking protocol state
        if (this.cancelKittyDetection) {
            this.cancelKittyDetection();
        }
        if (this.kittyProtocolEnabled) {
            try {
                this.options.stdout.write('\u001B[<u');
            }
            catch {
                // Best-effort: stdout may already be destroyed during shutdown
            }
            this.kittyProtocolEnabled = false;
        }
        // CIs don't handle erasing ansi escapes well, so it's better to
        // only render last frame of non-static output
        if (isInCi) {
            this.options.stdout.write(this.lastOutput + '\n');
        }
        else if (!this.options.debug) {
            this.log.done();
        }
        this.isUnmounted = true;
        if (this.options.concurrent) {
            // Concurrent mode: use updateContainer (async scheduling)
            reconciler.updateContainer(null, this.container, null, noop);
        }
        else {
            // Legacy mode: use updateContainerSync + flushSyncWork (sync)
            reconciler.updateContainerSync(null, this.container, null, noop);
            reconciler.flushSyncWork();
        }
        instances.delete(this.options.stdout);
        // Ensure all queued writes have been processed before resolving the
        // exit promise. For real writable streams, queue an empty write as a
        // barrier — its callback fires only after all prior writes complete.
        // For non-stream objects (e.g. test spies), resolve on next tick.
        //
        // When called from signal-exit during process shutdown (error is a
        // number or null rather than undefined/Error), resolve synchronously
        // because the event loop is draining and async callbacks won't fire.
        const resolveOrReject = () => {
            if (error instanceof Error) {
                this.rejectExitPromise(error);
            }
            else {
                this.resolveExitPromise();
            }
        };
        const isProcessExiting = error !== undefined && !(error instanceof Error);
        if (isProcessExiting) {
            resolveOrReject();
        }
        else if (this.options.stdout._writableState !== undefined ||
            this.options.stdout.writableLength !== undefined) {
            this.options.stdout.write('', resolveOrReject);
        }
        else {
            setImmediate(resolveOrReject);
        }
    }
    async waitUntilExit() {
        this.exitPromise ||= new Promise((resolve, reject) => {
            this.resolveExitPromise = resolve;
            this.rejectExitPromise = reject;
        });
        if (!this.beforeExitHandler) {
            this.beforeExitHandler = () => {
                this.unmount();
            };
            process.once('beforeExit', this.beforeExitHandler);
        }
        return this.exitPromise;
    }
    clear() {
        if (!isInCi && !this.options.debug) {
            this.log.clear();
            // Sync lastOutput so that unmount's final onRender
            // sees it as unchanged and log-update skips it
            this.log.sync(this.lastOutputToRender || this.lastOutput + '\n');
        }
    }
    patchConsole() {
        if (this.options.debug) {
            return;
        }
        this.restoreConsole = patchConsole((stream, data) => {
            if (stream === 'stdout') {
                this.writeToStdout(data);
            }
            if (stream === 'stderr') {
                const isReactMessage = data.startsWith('The above error occurred');
                if (!isReactMessage) {
                    this.writeToStderr(data);
                }
            }
        });
    }
    initKittyKeyboard() {
        // Protocol is opt-in: if kittyKeyboard is not specified, do nothing
        if (!this.options.kittyKeyboard) {
            return;
        }
        const opts = this.options.kittyKeyboard;
        const mode = opts.mode ?? 'auto';
        if (mode === 'disabled' ||
            !this.options.stdin.isTTY ||
            !this.options.stdout.isTTY) {
            return;
        }
        const flags = opts.flags ?? ['disambiguateEscapeCodes'];
        if (mode === 'enabled') {
            this.enableKittyProtocol(flags);
            return;
        }
        // Auto mode: use heuristic precheck, then confirm with protocol query
        const term = process.env['TERM'] ?? '';
        const termProgram = process.env['TERM_PROGRAM'] ?? '';
        const isKnownSupportingTerminal = 'KITTY_WINDOW_ID' in process.env ||
            term === 'xterm-kitty' ||
            termProgram === 'WezTerm' ||
            termProgram === 'ghostty';
        if (!isInCi && isKnownSupportingTerminal) {
            this.confirmKittySupport(flags);
        }
    }
    confirmKittySupport(flags) {
        const { stdin, stdout } = this.options;
        let responseBuffer = '';
        const cleanup = () => {
            this.cancelKittyDetection = undefined;
            clearTimeout(timer);
            stdin.removeListener('data', onData);
            // Re-emit any buffered data that wasn't the protocol response,
            // so it isn't lost from Ink's normal input pipeline.
            // Clear responseBuffer afterwards to make cleanup idempotent.
            // eslint-disable-next-line no-control-regex
            const remaining = responseBuffer.replace(/\u001B\[\?\d+u/, '');
            responseBuffer = '';
            if (remaining) {
                stdin.unshift(Buffer.from(remaining));
            }
        };
        const onData = (data) => {
            responseBuffer +=
                typeof data === 'string' ? data : Buffer.from(data).toString();
            // eslint-disable-next-line no-control-regex
            if (/\u001B\[\?\d+u/.test(responseBuffer)) {
                cleanup();
                if (!this.isUnmounted) {
                    this.enableKittyProtocol(flags);
                }
            }
        };
        // Attach listener before writing the query so that synchronous
        // or immediate responses are not missed.
        stdin.on('data', onData);
        const timer = setTimeout(cleanup, 200);
        this.cancelKittyDetection = cleanup;
        stdout.write('\u001B[?u');
    }
    enableKittyProtocol(flags) {
        this.options.stdout.write(`\u001B[>${resolveFlags(flags)}u`);
        this.kittyProtocolEnabled = true;
    }
}
//# sourceMappingURL=ink.js.map