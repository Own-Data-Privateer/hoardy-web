{ pkgs ? import <nixpkgs> {}
, lib ? pkgs.lib
}:

{

  src = lib.cleanSourceWith {
    src = ./.;
    filter = name: type: let baseName = baseNameOf (toString name); in
      (builtins.match ".*.un~" baseName == null)
      && (baseName != "dist")
      && (baseName != "result")
      && (baseName != "results")
      && (baseName != "__pycache__")
      && (baseName != ".mypy_cache")
      && (baseName != ".pytest_cache")
      && (builtins.match ".*/simple_server/pwebarc-dump.*" name == null)
      ;
  };

  unpackPhase = ''
    mkdir home
    HOME=$PWD/home
    ${pkgs.git}/bin/git config --global --add safe.directory '*'

    ${pkgs.git}/bin/git clone $src source
    ${pkgs.git}/bin/git clone $src/vendor/pako source/vendor/pako
    cp -a $src/extension/private source/extension || true
    patchShebangs source
    find source | grep -vF '/.git/'
  '';

}
