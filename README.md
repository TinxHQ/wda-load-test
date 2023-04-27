# Load testing WDA with real requests

Run the script

```sh
[DEBUG=1] [SESSION_DURATION=10] SERVER=xxx LOGIN=xxx PASSWORD=xxx node index.js
```

`DEBUG` when set to `1` will output the script status with timing.
`SESSION_DURATION` is the number in second that we should wait before unregistering and logging out.

## Using docker

```sh
docker build . -t wda-load-testing
docker run --rm --name wda -e SERVER=xxx -e LOGIN=xxx -e PASSWORD=xxx [-e DEBUG=1] [-e SESSION_DURATION=10] -t wda-load-testing
```

