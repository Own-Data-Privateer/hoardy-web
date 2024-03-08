# Example scripts using `wrrarms`

- [`wrrarms-xdg-open`](./wrrarms-xdg-open) script will open the contents of a given `.wrr` file via `xdg-open`.

- [`wrrarms-w3m`](./wrrarms-w3m) and [`wrrarms-w3m-jq`](./wrrarms-w3m-jq) scripts will feed the contents of a given `.wrr` file to `w3m -T text/html -dump`, converting to HTML pages into plain-text. The former only uses `coreutils`, latter is a bit more efficient, but needs `jq` utility.

- [`wrrarms-pandoc`](./wrrarms-pandoc) script that converts HTML pages into plain-text via `pandoc`.
