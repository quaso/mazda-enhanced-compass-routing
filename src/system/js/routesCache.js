var RoutesCache = (function () {

    // Instance stores a reference to the Singleton
    var instance;

    function init() {

        // Singleton

        // Private methods and variables

        function objToString(obj, ndeep) {
            switch (typeof obj) {
                case "string":
                    return '"' + obj + '"';
                case "function":
                    return obj.name || obj.toString();
                case "object":
                    var indent = Array(ndeep || 1).join('\t'), isArray = Array.isArray(obj);
                    return ('{['[+isArray] + Object.keys(obj).map(function (key) {
                        return '\n\t' + indent + (isArray ? '' : key + ': ') + objToString(obj[key], (ndeep || 1) + 1);
                    }).join(',') + '\n' + indent + '}]'[+isArray]).replace(
                        /[\s\t\n]+(?=(?:[^\'"]*[\'"][^\'"]*[\'"])*[^\'"]*$)/g, '');
                default:
                    return obj.toString();
            }
        };

        /**
         * check if distance between gonnabe-start and route start is within range
         */
        function checkStartDistance(start, routeStart) {
            var distanceStart = GeoUtils.getInstance().distance(start, routeStart);
            return distanceStart <= Navigation.getInstance().MAX_DISTANCE;
        }

        /**
         * check if gonnabe-destination and route destination are the same
         */
        function checkDestDistance(dest, routeDest) {
            return Math.abs(routeDest.lat - dest.lat) < 0.000001 && Math.abs(routeDest.lng - dest.lng) < 0.000001;
        }

        function generateUUID() {
            var d = new Date().getTime();
            if (window.performance && typeof window.performance.now === "function") {
                d += performance.now(); // use high-precision timer if available
            }
            var uuid = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
                var r = (d + Math.random() * 16) % 16 | 0;
                d = Math.floor(d / 16);
                return (c == 'x' ? r : (r & 0x3 | 0x8)).toString(16);
            });
            return uuid;
        }

        return {
            // Public methods and variables
            cacheResult: function (startLat, startLng, destLat, destLng, routeStruct) {
                var x = btoa(escape(objToString({
                    start: new LatLng(startLat, startLng), dest: new LatLng(destLat, destLng), data: routeStruct
                })));
                var text = unescape(atob(x));
                WebSql.getInstance().insertRouteToDb(startLat, startLng, destLat, destLng, text);
            },

            readFromCache: function (start, dest, readFromCacheCallback) {
                var result = null;

                // read from file
                for (var i = 0; i < Object.keys(CACHED_ROUTES).length; i++) {
                    var route = CACHED_ROUTES[i];
                    // check if destination matches and if start is within range
                    if (checkDestDistance(dest, route.dest) && checkStartDistance(start, route.start)) {
                        console.info("found route in file");
                        result = route.data;
                        break;
                    }
                }

                if (result != null) {
                    readFromCacheCallback(result);
                } else {
                    // read from WebSQL
                    WebSql.getInstance().findRoutesToDestinationInDb(dest, function (results) {
                        var result = null;
                        // check if destination matches and if start is within range
                        for (var i = 0; i < results.rows.length; i++) {
                            var row = results.rows[i];
                            if (checkStartDistance(start, new LatLng(row.startLat, row.startLng))) {
                                console.info("found route in WebSQL");
                                var route = eval('(' + row.data + ')');
                                result = route.data;
                                break;
                            }
                        }
                        readFromCacheCallback(result);
                    });
                }
            },

            readMoreFromCache: function (dest, readMoreFromCacheCallback) {
                var result = [];

                if (typeof (dest.lat) != "undefined") {
                    // read from file
                    for (var i = 0; i < Object.keys(CACHED_ROUTES).length; i++) {
                        var route = CACHED_ROUTES[i];
                        // check if destination matches
                        if (checkDestDistance(dest, route.dest)) {
                            result.push(route);
                        }
                    }

                    // read from WebSQL
                    WebSql.getInstance().findRoutesToDestinationInDb(dest, function (dbResults) {
                        // check if destination matches and if start is within range
                        for (var i = 0; i < dbResults.rows.length; i++) {
                            var row = dbResults.rows[i];
                            var route = eval('(' + row.data + ')');
                            result.push(route);
                        }
                        console.info("found " + result.length + " cached routes to destination");
                        readMoreFromCacheCallback(result);
                    });
                }
            },

            clearCachedRoutes: function () {
                WebSql.getInstance().clearDbCachedRoutes();
            },

            exportCachedRoutes: function (exportProgressCallback) {
                if (SETTINGS.exportEmail == null || SETTINGS.exportEmail === "") {
                    exportProgressCallback("Export email not set. Cannot export routes.");
                    return;
                }

                WebSql.getInstance().findAllRoutes(function (results) {
                    var toBeUploaded = results.rows.length;
                    if (toBeUploaded == 0) {
                        exportProgressCallback("No routes for export");
                        return;
                    }

                    var uploadingRouteId = 1;
                    var uuid = generateUUID();
                    var errorDetected = null;

                    function callbackInternal() {
                        console.info("Exported " + uploadingRouteId + "/" + toBeUploaded + " routes");
                        exportProgressCallback("Exported " + uploadingRouteId + "/" + toBeUploaded + " routes");
                        // wait till all routes are send, then call sendEmail
                        if (toBeUploaded == uploadingRouteId) {
                            // uploading finished
                            if (errorDetected != null) {
                                exportProgressCallback("Exporting error " + errorDetected.status + ": "
                                    + errorDetected.statusText);
                            } else {
                                exportProgressCallback("Sending routes to " + SETTINGS.exportEmail);
                                $.ajax({
                                    url: SETTINGS.exportURI + "/sendEmail", type: 'POST', data: JSON.stringify({
                                        uuid: uuid, email: SETTINGS.exportEmail
                                    }), dataType: 'json', contentType: "application/json", processData: false
                                }).done(function (data) {
                                    console.info("routes sent by email");
                                    exportProgressCallback("Routes successfully exported to " + SETTINGS.exportEmail);
                                }).fail(function (jqXHR, textStatus, errorThrown) {
                                    console.info(jqXHR);
                                });
                            }
                        } else {
                            uploadingRouteId++;
                        }
                    };

                    for (var i = 0; i < results.rows.length; i++) {
                        var row = results.rows[i];
                        var route = eval('(' + row.data + ')');
                        console.info("Exporting route [start=[lat=" + route.start.lat + ", lng=" + route.start.lng
                            + "], dest=[lat=" + route.dest.lat + ", lng=" + route.dest.lng + "]]");
                        $.ajax({
                            url: SETTINGS.exportURI + "/importRoute", type: 'POST', data: JSON.stringify({
                                uuid: uuid, route: route
                            }), dataType: 'json', contentType: "application/json", processData: false
                        }).done(function (data) {
                            console.info("route uploaded");
                        }).fail(function (jqXHR, textStatus, errorThrown) {
                            console.info(jqXHR);
                            if (errorDetected == null) {
                                errorDetected = jqXHR;
                            }
                        }).always(function () {
                            callbackInternal();
                        });
                    }
                });
            },
        };
    };

    return {

        // Get the Singleton instance if one exists or create one if it doesn't
        getInstance: function () {
            if (!instance) {
                instance = init();
            }
            return instance;
        }
    };
})();
