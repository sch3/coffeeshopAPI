//TODO Uninstall body parser if not used
var https = require('https');
var http = require('http');
var fs = require('fs');
var express = require('express');
var bodyParser = require('body-parser');
var app = express();
var async = require("async");

var sqlite3 = require('sqlite3').verbose();
var db = new sqlite3.Database(':memory:');
// additional features could be: find within range endpoint, swagger ui spec, session(?), needing login credentials(?), actual html being served to test functionality
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
        /**
        csv
         .fromPath("locations.csv")
         .on("data", function(data){
            console.log(data);
            //console.log(data[0]+" "+data[1]+" "+data[2]+" "+data[3]+" "+data[4])
            stmt.run(data[0],data[1],data[2],data[3],data[4]);
         })
         .on("end", function(){
            stmt.finalize();
            console.log("Done inserting csv. Started server!");
         });
        
        db.each("SELECT * FROM coffeeshops", function(err, row) {
            console.log(row);
        });
        **/
        
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
    console.log(request.query);
    var limit = request.query.limit ? request.query.limit : 0;
    console.log(request.params.address);
    geocoder.geocode(request.params.address, function(error, res) {
        //if err probably not an actual address
        //tries to catch one or the other
        if(error||res[0]===undefined){
            console.log("Did not find address");
            response.status(404);
        }
        else{
            //geocoder 
            console.log("Geocoded address");
            console.log(res[0]['latitude']+ " "+res[0]['longitude']);
            //SELECT * AS distance FROM items ORDER BY ((location_lat-lat)*(location_lat-lat)) + ((location_lng - lng)*(location_lng - lng)) ASC
            //var sqldistance = "SELECT *, ACOS(SIN(RADIANS(:lat)) * SIN(RADIANS(lat)) + COS(RADIANS(:lat)) * COS(RADIANS(lat))* COS(RADIANS(lng - :lng))) * 3959 AS distance FROM places WHERE  distance <= 10 ORDER BY distance;"
            //var sqldistance = "SELECT *, ACOS(SIN(RADIANS(?)) * SIN(RADIANS(latitude)) + COS(RADIANS(?)) * COS(RADIANS(latitude))* COS(RADIANS(longitude - ?))) * 3959 AS distance FROM coffeeshops ORDER BY distance ASC;"
            //"SELECT * AS distance FROM items ORDER BY ((location_lat-lat)*(location_lat-lat)) + ((location_lng - lng)*(location_lng - lng)) ASC";
            //var sqldistance = "SELECT * FROM coffeeshops ORDER BY ((?-latitude)*(?-latitude)) + ((? - longitude)*(? - longitude)) ASC";
            console.log(limit);
            // if limit is 0 or didn't exist, return just 1
            if(limit<1){
                var sqldistance = "SELECT *, ((?-latitude)*(?-latitude)) + ((? - longitude)*(? - longitude)) AS distance FROM coffeeshops ORDER BY distance ASC";
                var distancestmt = db.prepare(sqldistance);
                distancestmt.get([res[0]['latitude'],res[0]['latitude'],res[0]['longitude'],res[0]['longitude']], function(err,row){
                    if(err){
                        
                    }else{
                        response.json(row);
                    }
                });
            } else{
            // else return closest up to limit
                var sqldistancelimit = "SELECT *, ((?-latitude)*(?-latitude)) + ((? - longitude)*(? - longitude)) AS distance FROM coffeeshops ORDER BY distance ASC LIMIT ?";
                var distancestmtlmt = db.prepare(sqldistancelimit);
                distancestmtlmt.all([res[0]['latitude'],res[0]['latitude'],res[0]['longitude'],res[0]['longitude'],limit], function(err,row){
                    if(err){
                        
                    }else{
                        response.json(row);
                    }
                });
            }
        }
    });
    // seach by closet longitude/latitude distance
    //return result
});
// parse out parameters from post body? potentially could use put request if feasible. Return error if identical id is attempted to one stored already. Should return id of created coffeeshop
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