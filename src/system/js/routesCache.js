var RoutesCache = (function () {

    // Instance stores a reference to the Singleton
    var instance;

    function init() {

        // Singleton

        // Private methods and variables

        function parse(response, startLat, startLng, destLat, destLng) {

            // check for error codes
            // https://github.com/graphhopper/graphhopper/blob/master/docs/web/api-doc.md
            if (response.info.errors)
                return this.error(response);

            var route = response.paths[0];

            var routeStruct = {
                directions: []
            };
            routeStruct.summary = {
                distance: parseInt(route.distance, 10), duration: route.time / 1000
            };

            try {
                var path = decodePolyline(route.points);

                var instructions = route.instructions;

                var accContinueDistance = 0;
                var accContinueInstructionIntervalStart = null;
                var accContinueInstructionIntervalEnd;

                for (var i = 0, len = instructions.length; i < len; i++) {
                    var instruction = instructions[i];
                    if (instruction.sign == 0) { // CONTINUE_ON_STREET
                        if (accContinueInstructionIntervalStart == null) {
                            accContinueInstructionIntervalStart = instruction.interval[0];
                        }
                        accContinueInstructionIntervalEnd = instruction.interval[1];
                    } else {
                        var d = {
                            distance: accContinueDistance,
                            path: path.slice(accContinueInstructionIntervalStart,
                                accContinueInstructionIntervalEnd + 1), turnType: instruction.sign,
                            text: instruction.text,
                        }
                        if (typeof (instruction.exit_number) !== "undefined") {
                            d.exit_number = instruction.exit_number;
                        }
                        accContinueDistance = 0;
                        accContinueInstructionIntervalStart = instruction.interval[0];
                        accContinueInstructionIntervalEnd = instruction.interval[1];
                        routeStruct.directions.push(d);
                    }
                    accContinueDistance += parseInt(instruction.distance, 10);
                }
                // last instruction is always FINISH
            } catch (e) {
                return {
                    error: e.message
                };
            }
            routeStruct.path = path;

            cacheResult(startLat, startLng, destLat, destLng, routeStruct);

            return new Route().parse(routeStruct);
        };

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

        function prepareDatabase(error) {
            var db = openDatabase('mazdaCachedRoutesDb', '1.0', 'mazda cached routes database', 2 * 1024 * 1024);
            db.transaction(function (tx) {
                tx.executeSql("CREATE TABLE IF NOT EXISTS latlng (id INTEGER PRIMARY KEY, lat, lng)");
                tx.executeSql("CREATE TABLE IF NOT EXISTS route (startId, destId, data)");
            });
            return db;
        };

        function findOrCreateLatLng(tx, lat, lng, callback) {
            tx.executeSql("SELECT id FROM latlng WHERE lat=? AND lng=?", [lat, lng], function (tx, results) {
                if (results.rows.length > 0) {
                    callback(results.rows.item(0).id);
                } else {
                    tx.executeSql('INSERT INTO latlng (lat, lng) VALUES (?, ?)', [lat, lng], function (tx, results) {
                        callback(results.insertId);
                    });
                }
            });
        };

        function insertRouteToDb(startLat, startLng, destLat, destLng, data) {
            var db = prepareDatabase();
            db.transaction(function (tx) {
                findOrCreateLatLng(tx, startLat, startLng, function (startId) {
                    findOrCreateLatLng(tx, destLat, destLng, function (destId) {
                        tx.executeSql("INSERT INTO route (startId, destId, data) VALUES (?, ?, ?)",
                            [startId, destId, data]);
                    });
                });
            });
        };

        function findRoutesToDestinationInDb(dest, callback) {
            var db = prepareDatabase();
            db.transaction(function (tx) {
                findOrCreateLatLng(tx, dest.lat, dest.lng, function (destId) {
                    tx.executeSql(
                        "SELECT latlng.lat AS startLat, latlng.lng AS startLng, route.data AS data FROM route INNER JOIN latlng ON route.startId=latlng.id WHERE route.destId=?",
                        [destId], function (tx, results) {
                            callback(results);
                        });
                });
            });
        };

        function findAllRoutes(callback) {
            var db = prepareDatabase();
            db.transaction(function (tx) {
                tx.executeSql(
                    "SELECT data FROM route", [], function (tx, results) {
                        callback(results);
                    });
            });
        };

        return {
            // Public methods and variables
            cacheResult: function (startLat, startLng, destLat, destLng, routeStruct) {
                var x = btoa(escape(objToString({
                    start: new LatLng(startLat, startLng), dest: new LatLng(destLat, destLng), data: routeStruct
                })));
                var text = unescape(atob(x));
                insertRouteToDb(startLat, startLng, destLat, destLng, text);
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
                    findRoutesToDestinationInDb(dest, function (results) {
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
                    findRoutesToDestinationInDb(dest, function (dbResults) {
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
                var db = prepareDatabase();
                db.transaction(function (tx) {
                    tx.executeSql("DELETE FROM route", []);
                });
            },

            exportCachedRoutes: function (exportProgressCallback) {
                if (SETTINGS.exportEmail == null || SETTINGS.exportEmail === "") {
                    exportProgressCallback("Export email not set. Cannot export routes.");
                    return;
                }

                findAllRoutes(function (results) {
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
