var https = require('https');
var http = require('http');
var fs = require('fs');
var express = require('express');
var bodyParser = require('body-parser');
var app = express();
var async = require("async");

var sqlite3 = require('sqlite3').verbose();
var db = new sqlite3.Database(':memory:');
var geocoderProvider = 'google';
var httpAdapter = 'https';
var extra = {
    formatter: null         // 'gpx', 'string', ...
};
var geocoder = require('node-geocoder')(geocoderProvider, httpAdapter, extra);
var csv = require("fast-csv");
app.use(express.json());
// error messages or other constants
var err500 = "Internal Server Error: Please try again later";
var HashMap = require('hashmap');
var distance = require('google-distance');
var server = http.createServer(app).listen(8080, function() {
    //create db in memory and load via csv with columns id, name, address, latitude, longitude
    /**
    DB SCHEMA
    CREATE TABLE coffeeshops (
     id integer PRIMARY KEY UNIQUE,
     name text NOT NULL,
     address text NOT NULL,
     latitude real NOT NULL,
      longitude real NOT NULL UNIQUE
    );
    **/
    db.serialize(function() {
        db.run("CREATE TABLE if not exists coffeeshops (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL,address TEXT NOT NULL,latitude INT NOT NULL,longitude INT NOT NULL)");
        var stmt = db.prepare("INSERT INTO coffeeshops VALUES (?,?,?,?,?)");
        console.log("Created TABLE");
        //check if csv file exists
        fs.stat('locations.csv', function(err, stat) {
            if(err == null) {
                console.log('File exists');
            } else if(err.code == 'ENOENT') {
                // file does not exist
                console.log("Warning: Starting with no locations.csv");
            } else {
                console.log('Warning:', err.code);
            }
        });
        var stream = fs.createReadStream("locations.csv");
 
        csv
         .fromStream(stream)
         .on("data", function(data){
            //locations.csv final line does not read correctly in this library. this is an exception for that one or for faulty data
            if(data[1].trim().length>0){
                stmt.run(data[0],data[1],data[2],data[3],data[4]);
            }else{
                var toinsert = data[0];
                var inserted = 1;
                for(var i =1;i<data.length;i++){
                    if(data[i].trim() && inserted <5){
                        if(isNaN(data[i].trim())){}
                            toinsert = toinsert + ","+"\'"+data[i]+"\'";
                        }else{
                            toinsert = toinsert + ","+data[i];
                        }
                        inserted++;
                    }
                db.run("INSERT INTO coffeeshops VALUES ("+toinsert.replace(/ ,/g, "")+")", function(err){
                    if(err){
                        console.log("err inserting potentially faulty row");       
                    }
                });
            }
                
         })
         .on("end", function(){
             stmt.finalize();
            console.log("Done inserting csv. Started server!");
         });
        
    });    
	
});
// get by id, returns  id, name, address, latitude, and longitude of the coffee shop with that id, or an appropriate error if it is not found
app.get('/read/:id', function(req, res, next){
    //should use db.get to only get first one. there should be no duplicates, so no point to get more
    var getstmt = db.get("SELECT * FROM coffeeshops WHERE id=?",[req.params.id], function(err, row){
        var error = {};
        if(err){
            error["error"] = err500;
            res.status(500).json(error);
        }else{
            if(row){
                res.json(row);
            } else{
                error["error"] = "Could not find coffeeshop with id "+req.params.id;
                res.status(404).json(error);
            }
        }
    });
    
});
//Accepts an id and new values for the name, address, latitude, or longitude fields, updates the coffee shop with that id, or returns an appropriate error if it is not found. Could use put if possible
app.put('/update/:id', function(request, response){
    //TODO: implement some kind of dynamic update query via put body?
    var responsejson = {};
    if(request.body && request.params.id){
        var toadd = new HashMap();
        if(request.body["name"]) toadd.set("name","\'"+request.body["name"]+"\'");
        if(request.body["address"]) toadd.set("address","\'"+request.body["address"]+"\'");
        if(request.body["latitude"]) toadd.set("latitude",request.body["latitude"]);
        if(request.body["longitude"]) toadd.set("longitude",request.body["longitude"]);
        var toupdate = "";
        toadd.forEach(function(value, key) {
            if(toupdate.length==0){
                toupdate = toupdate+ key+" = "+value; 
            } else{
                toupdate = toupdate + ", "+key+" = "+value;
                
            }
        });
        var sql = "UPDATE coffeeshops SET "+toupdate+" WHERE id = ?";
        var updatestmt = db.prepare(sql);
        updatestmt.run([request.params.id], function(err){
            if(err){
                responsejson["error"]="update statement encountered error";
                response.status(404).json(responsejson);
            }else{
                responsejson["status"]="updated coffeeshop successfully";
                response.json(responsejson);
            }
        });
    } else{
        //invalid request status
        responsejson["error"]="invalid request";
        response.status(400).json(responsejson);
    }
});
//Delete: Accepts an id and deletes the coffee shop with that id, or returns an error if it is not found. Could use delete http method
app.delete('/delete/:id', function(request, response){
    // should be serialized to avoid retrieval of deleted object
    db.serialize(function() {
        var deletestmt = db.run("DELETE FROM coffeeshops WHERE id=?",[request.params.id], function(err){
            var responsejson = {};
            if(err){
                responsejson["error"] = err500;
                response.status(500).json(responsejson);
            }else{
                if(this.changes>0){
                    responsejson["status"] = "Successful deletion";
                    response.status(200).json(responsejson);
                } else{
                    responsejson["status"] = "Unable to delete nonexistent row";
                    response.status(200).json(responsejson);
                }
            }
            
        });
        
    });        
});
//find nearest: Accepts an address and returns the closest coffee shop by straight line distance
app.get('/findnearest/:address', function(request, response){
    // geocode address to get longitude, latitude
    var limit = request.query.limit && request.query.limit>0 ? request.query.limit : 1;
    var responsejson = {}
    geocoder.geocode(request.params.address, function(error, res) {
        //if err probably not an actual address
        //tries to catch one or the other
        if(error||res[0]===undefined){
            responsejson["error"] = ("Did not find address");
            response.status(404).json(responsejson);
        }
        else{
            // seach by closet longitude/latitude distance
            //return result
            var sqldistancelimit = "SELECT *, ((?-latitude)*(?-latitude)) + ((? - longitude)*(? - longitude)) AS distance FROM coffeeshops ORDER BY distance ASC LIMIT ?";
            var distancestmtlmt = db.prepare(sqldistancelimit);
            distancestmtlmt.all([res[0]['latitude'],res[0]['latitude'],res[0]['longitude'],res[0]['longitude'],limit], function(err,row){
                if(err){
                    responsejson["error"] = err500;
                    response.status(500).json();
                }else{
                    response.json(row);
                }
            });
        }
    });
    
});
// find nearest using haversine formula
app.get('/findnearesthaversine/:address', function(request, response){
    var responsejson = {};
    var limit = request.query.limit && request.query.limit>0 ? request.query.limit : 1;
    geocoder.geocode(request.params.address, function(error, res) {
        //if err probably not an actual address
        //tries to catch one or the other
        if(error||res[0]===undefined){
            responsejson["error"] = ("Did not find address for haversine");
            response.status(404).json(responsejson);
        } else{
            db.serialize(function() {
                var temptablename = "findhaversine"+getRandomIntInclusive(0,1000000);
                db.run("CREATE TABLE if not exists "+temptablename+" (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL,address TEXT NOT NULL,latitude INT NOT NULL,longitude INT NOT NULL, distance INT NOT NULL)");
                var stmt = db.prepare("INSERT INTO "+temptablename+" VALUES (?,?,?,?,?,?)");
                db.each("SELECT * FROM coffeeshops", function(err, row) {
                    stmt.run(row['id'],row['name'],row['address'],row['latitude'],row['longitude'],getDistanceFromLatLonInKm(res[0]['latitude'],res[0]['longitude'],row.latitude,row.longitude));
                });
                var getstmt = db.prepare("SELECT * from "+temptablename+" ORDER BY distance ASC LIMIT ?");
                getstmt.all([limit],function(err,row){
                    if(err){
                        responsejson["error"] = err500;
                        response.status(500).json();
                    }else{
                        response.json(row);
                    }
                });
                db.run("DROP TABLE "+temptablename);
            });
        }
     });
});
//Copied from: https://stackoverflow.com/questions/27928/calculate-distance-between-two-latitude-longitude-points-haversine-formula
function getDistanceFromLatLonInKm(lat1,lon1,lat2,lon2) {
  var R = 6371; // Radius of the earth in km
  var dLat = deg2rad(lat2-lat1);  // deg2rad below
  var dLon = deg2rad(lon2-lon1); 
  var a = 
    Math.sin(dLat/2) * Math.sin(dLat/2) +
    Math.cos(deg2rad(lat1)) * Math.cos(deg2rad(lat2)) * 
    Math.sin(dLon/2) * Math.sin(dLon/2)
    ; 
  var c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a)); 
  var d = R * c; // Distance in km
  return d;
}

function deg2rad(deg) {
  return deg * (Math.PI/180)
}
//https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Math/random
function getRandomIntInclusive(min, max) {
  min = Math.ceil(min);
  max = Math.floor(max);
  return Math.floor(Math.random() * (max - min + 1)) + min; //The maximum is inclusive and the minimum is inclusive 
}
function findDistance(originlat,originlon, destinationlat,destinationlon,callback){

    distance.get(
      {
        origin: originlat+','+originlon,
        destination: destinationlat+','+destinationlon
      },
      function(err, data) {
        if (err) {
            callback(Number.POSITIVE_INFINITY);
        }
        else{
            callback(data.distanceValue);
        }

    });
}
app.get('/findnearestgoogle/:address', function(request, response){
    var responsejson = {};
    var limit = request.query.limit && request.query.limit>0 ? request.query.limit : 1;
    geocoder.geocode(request.params.address, function(error, res) {
        //if err probably not an actual address
        //tries to catch one or the other
        if(error||res[0]===undefined){
            responsejson["error"] = ("Did not find address for google distance api");
            response.status(404).json(responsejson);
        } else{
            db.serialize(function() {
                var temptablename = "findgoogle"+getRandomIntInclusive(0,1000000);
                db.run("CREATE TABLE if not exists "+temptablename+" (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL,address TEXT NOT NULL,latitude INT NOT NULL,longitude INT NOT NULL, distance INT NOT NULL)");
                var stmt = db.prepare("INSERT INTO "+temptablename+" VALUES (?,?,?,?,?,?)");
                db.all("SELECT * FROM coffeeshops", function(err, rows) {
                    async.each(rows, function(row, callback) {
                      // Perform operation on file here.
                      findDistance(res[0]["latitude"],res[0]["longitude"],row.latitude,row.longitude,function(result){
                           stmt.run(row['id'],row['name'],row['address'],row['latitude'],row['longitude'],result);
                            callback();
                        });
                    },function(err){
                        var getstmt = db.prepare("SELECT * from "+temptablename+" ORDER BY distance ASC LIMIT ?");
                        getstmt.all([limit],function(err,row){
                            if(err){
                                responsejson["error"] = err500;
                                response.status(500).json();
                            }else{
                                response.json(row);
                            }
                        });
                        db.run("DROP TABLE "+temptablename);
                    });
                });
                
            });
        }
     });
    
});
// Return error if identical id is attempted to one stored already. Should return id of created coffeeshop
app.post('/create', function(request, response){
    var responsejson= {};
    if(request.body){
        var createstmt = db.prepare("INSERT INTO coffeeshops VALUES (NULL,?,?,?,?)");
        // first param is null and increments automatically

        // latitude and longitude are necessary fields
        var lat = request.body["latitude"];
        var lon = request.body["longitude"];
        if(lat && lon){
            createstmt.run([request.body["name"],request.body["address"],request.body["latitude"],request.body["longitude"]], function(err){
                if(err){
                    responsejson["error"] = err500;
                    response.status(500).json(responsejson);
                }else{
                    responsejson["status"] = "Successful creation";
                    responsejson["id"] = this.lastID;
                    response.status(200).json(responsejson);
                }
            });
        }else{
            responsejson["error"]="invalid request";
            response.status(400).json(responsejson);
        }
    }else{
        responsejson["error"]="invalid request";
        response.status(400).json(responsejson);
    }
});
app.on('close', function () {
  console.log("Closed");
  db.close();
});