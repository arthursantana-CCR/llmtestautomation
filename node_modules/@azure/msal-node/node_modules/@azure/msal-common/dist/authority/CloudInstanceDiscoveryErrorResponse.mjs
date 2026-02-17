/*! @azure/msal-common v16.0.4 2026-02-10 */
'use strict';
/*
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License.
 */
function isCloudInstanceDiscoveryErrorResponse(response) {
    return (response.hasOwnProperty("error") &&
        response.hasOwnProperty("error_description"));
}

export { isCloudInstanceDiscoveryErrorResponse };
//# sourceMappingURL=CloudInstanceDiscoveryErrorResponse.mjs.map
