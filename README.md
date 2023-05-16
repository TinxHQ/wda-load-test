# Load testing WDA with real requests

Run the script

```sh
[DEBUG=1] [DISABLE_HEADER_CHECK=1] [DISABLE_CHATD=1] [REQUEST_TIMEOUT=300000] [SESSION_DURATION=10] [TOKEN_EXPIRATION=300] SERVER=xxx LOGIN=xxx PASSWORD=xxx node index.js
```

`DEBUG` when set to `1` will output the script status with timing.
`TOKEN_EXPIRATION` the token expiration in seconds.
`SESSION_DURATION` is the number in second that we should wait before unregistering and logging out.
`DISABLE_HEADER_CHECK` force the `X-User-UUID` header without check on the stack.
`REQUEST_TIMEOUT` API requests timeout in ms.

## Using docker

```sh
docker build . -t wda-load-testing
docker run --rm --name wda -e SERVER=xxx -e LOGIN=xxx -e PASSWORD=xxx [-e DEBUG=1] [-e DISABLE_CHATD=1] [-e REQUEST_TIMEOUT=300000] [-e DISABLE_HEADER_CHECK=1] [-e SESSION_DURATION=10] [-e TOKEN_EXPIRATION=300] -t wda-load-testing
```

