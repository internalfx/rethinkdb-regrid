docker pull rethinkdb:latest

./stop-test-server.sh

docker run -d -p 8080:8080 -p 28015:28015 -p 29015:29015 --name rethinkdb-regrid -v "$PWD/ignored_files/rethinkdb:/data" rethinkdb:latest rethinkdb --cache-size 2048 --bind all
