# CPM (Chickin Package Manager)

I made this tool mainly for my personnal use but I guess it could potentially interest others.

The readme is highly WIP, so a ton of stuff is still missing (, but will eventually be added).

# Installing

* linux : `wget https://raw.githubusercontent.com/ChickChicky/cpm/master/install.bash install-cpm.bash && sudo bash ./install-cpm.bash`
* windows : *TBD*

# Configuration

The configuration file can be found at:
* linux : */etc/.cpm/*
* windows : *%appdata%\\.cpm\\*

### Add A Source
* HTTP : `cpm source add --kind=http --href=<URL> --name=<SOURCE NAME>`

Note that the source URL must be the one to access the package list.

# Creating A Package

Create a `.cpmpkg` file inside of your package (you can use *"$schema":"https://gist.github.com/ChickChicky/6aba61e39b5c0b79d44caa16dc062458"*) to get hints on how to structure stuff

The three basic fields are:
* `id` : the ID of your package (must be unique)
* `name` : the longer name for your package
* `version` : the version of your package

You may also include fields like:
* `description` : an extended description for the package
* `authors` : the author(s) of the package
* `dependencies` : the list of packages that this package depends on
* `os` : an array of patterns that describe which OS the package is compatible with

# Sources

## HTTP Source

An HTTP source should return a JSON object containing the following fields:
* `install_kind` : a string that specifies the method to be used to download packages, see [this](#install-kinds) for more details
* `packages` : an array of objects formatted similarly to packages that may only include the following fields : *id*, *name*, *description*, *version*, *authors*, *dependencies*, *hidden*, *lib*

## Install kinds

A source must specify the method to be used to install the packages, and depending on the install_kind, others field will be required.
* `http` :
    * `install_href` : the href that will be used to query packages, `$package-id$` will be replaced by the ID of the package to be installed. If the source href is *http://example.com/cpm/list*, *'/packages/\$package-id\$'* will result in *http://example.com/packages/\**, *packages/\$package-id\$* will result in *https://example.com/cpm/packages/\**