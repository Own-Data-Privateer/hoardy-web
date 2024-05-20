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
  pname = "pwebarc-wrrarms";
  version = "0.11.2";
  format = "pyproject";

  inherit (source) src unpackPhase;
  sourceRoot = "${src.name}/tool";

  propagatedBuildInputs = [
    setuptools
    mycbor2
    kisstdlib
    idna
    html5lib
  ]
  ++ lib.optional mitmproxySupport mitmproxy;

  postInstall = ''
    patchShebangs script
    install -m 755 -t $out/bin script/wrrarms-*
  '';

} // lib.optionalAttrs debug {
  nativeBuildInputs = [
    mypy
    pytest
  ];

  preBuild = "find . ; mypy; pytest";
  postFixup = "find $out";
})
