<h1 align="center">
<img src="./images/logo.webp" height="200" /><br />
Lidarr++Deemix <br />
<small style="font-size: 1rem; font-style: italic">"If Lidarr and Deemix had a child"</small>
</h1>

## 💡 How it works

Lidarr pulls artist and album infos from their own api `api.lidarr.audio`, which pulls the data from MusicBrainz.

By providing a custom proxy, we can _hook into_ the requests/responses, and **_inject additional infos from deemix_**.

#### To do that, this image does the following things:

- Runs [mitmproxy](https://mitmproxy.org/) as a proxy (needs to be configured within Lidarr)
- The proxy then redirects all api.lidarr.audio calls to an internally running NodeJS service
- Executes `update-ca-certificates` within the Lidarr-container, to trust the proxy certificates

## 💻️ Installation

> [!NOTE]
> The folder `/lidarr-deemix-certs` must be mounted to `/usr/local/share/ca-certificates` within the Lidarr container
> `/var/run/docker.sock/` is needed, so lidarr-deemix can connect to lidarr and execute `update-ca-certificates`. If this is an issue, you have to manually execute that command, each time you restart the Lidarr container.

- Use the provided [docker-compose.yml](./docker-compose.yml) as an example.
- Go to **Lidarr -> Settings -> General** and set the proxy to `lidarr-deemix` and port **8080**

![settings](./images/lidarr-deemix-conf.png)
