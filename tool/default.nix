{ pkgs ? import <nixpkgs> {}
, lib ? pkgs.lib
, kisstdlib ? import ../vendor/kisstdlib { inherit pkgs; }
, source ? import ../source.nix { inherit pkgs; }
, debug ? false
}:

with pkgs.python3Packages;

buildPythonApplication (rec {
  pname = "pwebarc-wrrarms";
  version = "0.6";
  format = "pyproject";

  inherit (source) src unpackPhase;
  sourceRoot = "${src.name}/tool";

  propagatedBuildInputs = [
    setuptools
    cbor2
    kisstdlib
    idna
  ];
} // lib.optionalAttrs debug {
  nativeBuildInputs = [
    mypy
    pytest
  ];

  preBuild = "find . ; mypy; pytest";
  postInstall = "find $out";
})
