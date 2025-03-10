{ pkgs ? import <nixpkgs> {}
, lib ? pkgs.lib
, developer ? false
, kisstdlib ? import ../vendor/kisstdlib { inherit pkgs developer; }
, cbor2 ? import ../vendor/cbor2 { inherit pkgs; }
, source ? import ../source.nix { inherit pkgs; }
, mitmproxySupport ? true
}:

let mycbor2 = cbor2; in

with pkgs.python3Packages;

buildPythonApplication (rec {
  pname = "hoardy-web";
  version = "0.23.0";
  format = "pyproject";

  inherit (source) src unpackPhase;
  sourceRoot = "${src.name}/tool";

  propagatedBuildInputs = [
    setuptools
    kisstdlib
    sortedcontainers
    mycbor2
    idna
    html5lib
    tinycss2
    bottle
  ]
  ++ lib.optional mitmproxySupport mitmproxy;

  postInstall = ''
    patchShebangs script
    install -m 755 -t $out/bin script/hoardy-*
  '';

} // lib.optionalAttrs developer {
  nativeBuildInputs = [
    build twine pip mypy pytest black pylint
    pkgs.pandoc

    kisstdlib # for `describe-forest` binary
  ];

  preBuild = "find . ; ./sanity.sh --check";
  postFixup = "find $out";
})
