var WebSql = (function () {

    // Instance stores a reference to the Singleton
    var instance;

    function init() {

        // Singleton

        // Private methods and variables

        function prepareDatabase(error) {
            var db = openDatabase('mazdaCachedRoutesDb', '1.0', 'mazda cached routes database', 2 * 1024 * 1024);
            db.transaction(function (tx) {
                tx.executeSql("CREATE TABLE IF NOT EXISTS latlng (id INTEGER PRIMARY KEY, lat, lng)");
                tx.executeSql("CREATE TABLE IF NOT EXISTS route (startId, destId, data)");
                tx.executeSql("CREATE TABLE IF NOT EXISTS destination (latlngId INTEGER PRIMARY KEY, name)");
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

        return {
            // Public methods and variables
            insertRouteToDb: function (startLat, startLng, destLat, destLng, data) {
                console.info("Caching route [start=[lat=" + startLat + ", lng=" + startLng + "], dest=[lat=" + destLat + ", lng=" + destLng + "]]");
                var db = prepareDatabase();
                db.transaction(function (tx) {
                    findOrCreateLatLng(tx, startLat, startLng, function (startId) {
                        findOrCreateLatLng(tx, destLat, destLng, function (destId) {
                            tx.executeSql("INSERT INTO route (startId, destId, data) VALUES (?, ?, ?)",
                                [startId, destId, data]);
                        });
                    });
                });
            },

            findRoutesToDestinationInDb: function (dest, callback) {
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
            },

            findAllRoutes: function (callback) {
                var db = prepareDatabase();
                db.transaction(function (tx) {
                    tx.executeSql(
                        "SELECT data FROM route", [], function (tx, results) {
                            callback(results);
                        });
                });
            },

            clearDbCachedRoutes: function () {
                var db = prepareDatabase();
                db.transaction(function (tx) {
                    tx.executeSql("DELETE FROM route", []);
                });
            },

            insertDestinationToDb: function (lat, lng, name) {
                var db = prepareDatabase();
                db.transaction(function (tx) {
                    findOrCreateLatLng(tx, lat, lng, function (latlngId) {
                        tx.executeSql("INSERT INTO destination (latlngId, name) VALUES (?, ?)",
                            [latlngId, name]);
                    });
                });
            },

            findAllDestinations: function (callback) {
                var db = prepareDatabase();
                db.transaction(function (tx) {
                    tx.executeSql(
                        "SELECT latlng.lat AS lat, latlng.lng AS lng, name AS name FROM destination INNER JOIN latlng ON destination.latlngId = latlng.id", [], function (tx, results) {
                            callback(results);
                        });
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
