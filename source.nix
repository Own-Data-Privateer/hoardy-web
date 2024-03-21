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
      && (builtins.match ".*/dumb_server/pwebarc-dump.*" name == null)
      ;
  };

  unpackPhase = ''
    ${pkgs.git}/bin/git clone $src source
    cp -a $src/extension/private source/extension || true
    patchShebangs source
    find source | grep -vF 'source/.git/'
  '';

}
