{ pkgs ? import <nixpkgs> {}
, lib ? pkgs.lib
, source ? import ../source.nix { inherit pkgs; }
, developer ? false
}:

with pkgs.python3Packages;

buildPythonApplication (rec {
  pname = "hoardy-web-sas";
  version = "1.8.0";
  format = "pyproject";

  inherit (source) src unpackPhase;
  sourceRoot = "${src.name}/simple_server";

  propagatedBuildInputs = [
    setuptools
    cbor2
  ];

} // lib.optionalAttrs developer {
  nativeBuildInputs = [
    build twine pip mypy pytest black pylint
    pkgs.pandoc
  ];

  preBuild = "find . ; black --check . && mypy && pylint .";
  postFixup = "find $out";
})
