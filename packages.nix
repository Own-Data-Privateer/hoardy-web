{ pkgs ? import <nixpkgs> {}
}:

let source = import ./source.nix { inherit pkgs; }; in

{
  dumb_server = import ./dumb_server { inherit pkgs source; };
  extension = import ./extension { inherit pkgs source; };
}
