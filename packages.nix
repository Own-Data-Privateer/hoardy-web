{ pkgs ? import <nixpkgs> {}
, debug ? false
}:

let source = import ./source.nix { inherit pkgs; }; in

{
  simple_server = import ./simple_server { inherit pkgs source; };
  extension = import ./extension { inherit pkgs source; };
  tool = import ./tool { inherit pkgs source debug; };
}
