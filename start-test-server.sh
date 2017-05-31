docker pull rethinkdb:2.3

./docker-stop.sh

docker run -d -p 8080:8080 -p 28015:28015 -p 29015:29015 --name rethinkdb-regrid -v "$PWD/ignored_files/rethinkdb:/data" rethinkdb:2.3 rethinkdb --cache-size 2048 --bind all
