#!/usr/bin/env bash
function copy_install {
    srcpath=`pwd`
    mkdir -p ~/.cpm/bin/
    mkdir -p etc/.cpm/bin/
    cd ~/.cpm/
    cp $srcpath/cpm.js ~/.cpm/cpm.js             && echo "cp cpm.js"       || echo -e "\x1b[31mcp cpm.js\x1b[39m"
    cp $srcpath/package.js ~/.cpm/package.js     && echo "cp package.js"   || echo -e "\x1b[31mcp package.js\x1b[39m"
    cp $srcpath/package.json ~/.cpm/package.json && echo "cp package.json" || echo -e "\x1b[31mcp package.json\x1b[39m"
    npm install
    echo -e "#!/usr/bin/env bash\nnode ~/.cpm/cpm.js \$@" > ~/.cpm/bin/cpm
    echo "Installation completed, add \`export PATH=\"~/.cpm/bin:/etc/.cpm/bin:\"\$PATH\` to your profile to be able to access CPM"
}

function clone_install {
    mkdir -p ~/.cpm/bin/
    mkdir -p etc/.cpm/bin/
    cd ~/.cpm/
    git clone git@github.com:ChickChicky/cpm.git
}

if [ "$OSTYPE" == "linux-gnu"* ] || [ "$OSTYPE" == "cygwin" ] || [ "$OSTYPE" == "msys" ]; then
    if [ -f ./cpm.js ] && [ -f ./package.js ] && [ -f ./package.json ]; then
        if [ -a ./.git ]; then
            copy_install
        else
            echo ".git folder not found, do you wish to install CPM from GitHub ? (Y/n)"
            read -p ">" ans
            if [[ $ans =~ [nN](o)* ]]; then
                copy_install
            elif [[ $ans =~ [yY](es)* ]] || [ -z $ans ]; then
                clone_install
            else
                echo "Cancelled installation."
            fi
        fi
    else
        echo "Some files are missing, do you wish to install CPM from GitHub ? (Y/n)"
        read -p ">" ans
        if [[ $ans =~ [nN](o)* ]]; then
            copy_install
        elif [[ $ans =~ [yY](es)* ]] || [ -z $ans ]; then
            clone_install
        else
            echo "Cancelled installation."
        fi
    fi
else
    echo -e "\x1b[31mERROR\x1b[39m: Unsupported os \`$OSTYPE\`"
fi