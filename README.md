Running project locally:
Pull latest code from git repo via git pull
npm install
node server.js


App will load coffee shops from locations.csv into in memory db on startup. It can then be accessed in a browser using https://localhost:8080/


## APIs and test commands

* GET
/read/<id>: returns coffeeshop with given id if it exists
Example: curl -X GET http://localhost:8080/read/11

/findnearest/<address>(?limit=<limit>): Finds closest coffeeshop(s) using pythagorean theorem. Returns up to limit, minimum 1. Returns distance after using pythagorean theorem with given coordinates.
Example:
curl -X GET 'http://localhost:8080/findnearest/535%20Mission%20St.,%20San%20Francisco,%20CA'
Example with limit: 
curl -X GET 'http://localhost:8080/findnearest/%2050%20Fremont%20St?limit=3'

/findnearesthaversine/<address>(?limit=<limit>): Finds closest coffeeshop(s) using haversine formula. Returns up to limit, minimum 1. Returns distance in km
Example: 
curl -X GET 'http://localhost:8080/findnearesthaversine/252%20Guerrero%20St,%20San%20Francisco,%20CA%2094103,%20USA'
Example with limit:
curl -X GET 'http://localhost:8080/findnearesthaversine/111%20Minna%20St?limit=3'

/findnearestgoogle/<address>(?limit=<limit>): Find closest coffeeshop(s) using google distance matrix. Returns up to limit, minimum 1. Returns distance in m.
Example:
curl -X GET http://localhost:8080/findnearestgoogle/720%20Market%20St
Example with limit:
curl -X GET 'http://localhost:8080/findnearestgoogle/115%20Sansome%20St?limit=3'

* POST
/create: Accepts name, address, latitude, and longitude, adds a new coffee shop to the data set, and returns the id of the new coffee shop.
Example:
curl -X POST \
  http://localhost:8080/create \
  -H 'Content-Type: application/json' \
  -d '{
	"name" : "anothertestname",
	"address" : "testaddress",
	"latitude" : "37.782394430549445",
    "longitude": "-122.40997343121123"
}'
* PUT
/update/<id>: Update entry with given id if it exists. Uses application/json body.
Example:
curl -X PUT \
  http://localhost:8080/update/5 \
  -H 'Content-Type: application/json' \
  -d '{
	"name" : "test123",
	"address" : "testaddress",
	"latitude" : "37.782394430549445",
    "longitude": "-102.40997343121123"
}'
* DELETE
/delete/<id>: Deletes row from in memory db if id exists
Example: curl -X DELETE http://localhost:8080/delete/3

## Bugs and Issues
* findgoogle is slow due to asynchronous google requests
* csv file parsing mangles final row of given locations.csv. Had to create a recovery function for that row
* Body parser prints out an exception trace to console if invalid json is passed in via a request. However, this will not stop server.
## Challenges and Future Features

* Sqlite node js library has no math functions or function creation support. This made implementation of the more accurate distance endpoints more difficult than it should have been and less efficient.
* additional features could be given more time: find within range endpoint, swagger ui spec, session, needing login credentials for operations, actual html being served to test functionality

## Creator

sch3