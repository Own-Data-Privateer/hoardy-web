{ pkgs ? import <nixpkgs> {}
, lib ? pkgs.lib
, kisstdlib ? import ../vendor/kisstdlib { inherit pkgs; }
, cbor2 ? import ../vendor/cbor2 { inherit pkgs; }
, source ? import ../source.nix { inherit pkgs; }
, debug ? false
, mitmproxySupport ? true
}:

let mycbor2 = cbor2; in

with pkgs.python3Packages;

buildPythonApplication (rec {
  pname = "hoardy-web";
  version = "0.20.0";
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

} // lib.optionalAttrs debug {
  nativeBuildInputs = [
    build twine pip black pylint
    pkgs.pandoc
    mypy
    pytest
  ];

  preBuild = "find . ; mypy; pytest";
  postFixup = "find $out";
})
