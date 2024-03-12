{ pkgs ? import <nixpkgs> {}
, lib ? pkgs.lib
, kisstdlib ? import ../vendor/kisstdlib { inherit pkgs; }
, source ? import ../source.nix { inherit pkgs; }
, debug ? false
, mitmproxySupport ? true
}:

with pkgs.python3Packages;

buildPythonApplication (rec {
  pname = "pwebarc-wrrarms";
  version = "0.8.1";
  format = "pyproject";

  inherit (source) src unpackPhase;
  sourceRoot = "${src.name}/tool";

  propagatedBuildInputs = [
    setuptools
    cbor2
    kisstdlib
    idna
  ]
  ++ lib.optional mitmproxySupport mitmproxy;

} // lib.optionalAttrs debug {
  nativeBuildInputs = [
    mypy
    pytest
  ];

  preBuild = "find . ; mypy; pytest";
  postInstall = "find $out";
})
