docker run -d -p 8080:8080 -p 28015:28015 --name rethinkdbfs-test -v "$PWD/test_data/rethinkdb:/data" rethinkdb
