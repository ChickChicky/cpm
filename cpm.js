const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const readline = require('node:readline/promises');
const cp = require('node:child_process');

const glob = require('glob-to-regexp');

const {package,unpackage,get_package_cfg} = require('./package');

const args = [];
const flags = {};

const sys = `${process.platform}-${process.arch}`;

const appdata = {
    'win32' : path.join(os.userInfo().homedir,'AppData','Roaming','.cpm'),
    'linux' : '/etc/.cpm/'
}[process.platform];

const bindir = path.resolve(path.join(appdata,'.bin'));
const cpmbin = process.platform=='win32'? path.join(bindir,'cpm.bat') : path.join(bindir,'cpm.bash');

if (appdata == undefined) {
    console.error(`Unsupported Platform \`${process.platform}\``);
    process.exit(1);
}

const default_cfg = {
    installPath: '$appdata$/package/$package-id$'
};

// Ensures all config files are present
fs.mkdirSync(appdata,{recursive:true});

const cpm_files = [
    [ 'db.json',     '[]', 'utf-8' ],
    [ 'source.json', '[]', 'utf-8' ],
    [ 'local.json',  '[]', 'utf-8' ],
    [ 'bins.json',   '[]', 'utf-8' ],
    [ '.bin',        null,  'dir'  ],
];
for (let [fn,contents,encoding] of cpm_files) {
    let fp = path.resolve(path.join(appdata,fn));
    if (!fs.existsSync(fp)) {
        if (encoding == 'dir')
            false || fs.mkdirSync(fp,{recursive:true});
        else
            false || fs.writeFileSync(fp,contents,encoding);
        console.log(`INFO: Created ${fp}`);
    }
}

if (process.platform == 'win32') {
    if (!fs.existsSync(path.join(appdata,'.bin','cpm.bat'))) fs.writeFileSync(path.join(appdata,'.bin','cpm.bat'),`@node ${__filename} %*`,'utf-8');
} else {
    if (!fs.existsSync(path.join(appdata,'.bin','cpm.bash'))) fs.writeFileSync(path.join(appdata,'.bin','cpm.bash'),`#!/usr/bin/env bash\nnode ${__filename} $@`,'utf-8');
}

if (!process.env.path.split(process.platform=='win32'?/;/g:/:/g).some(p=>p==bindir)) console.log(`\x1b[33mWARNING\x1b[39m: Could not find \`${bindir}\` inside of environment's PATH, some features might not work properly.`);

// Main stuff

for (let a of process.argv.slice(2)) {
    if (a.startsWith('-') && a != '-' && a != '--') {
        let {name,value} = a.match(/--?(?<name>.+)=(?<value>.+)/)?.groups??{};
        if (name == undefined || value == undefined)
            flags[a.match(/--?(.*)/)?.[1]??'<invalid>'] = true;
        else {
            flags[name] = value;
        }
    } else {
        args.push(a.replace(/^\\-/,'-'));
    }
}

const find_package = (id,{db=[],installed=[],filters=[],filter_all=true,show_hidden=true,sys=null,version_filter=true},array=false) => {
    let gid = glob(id);
    let matches = [];
    for (let source of db) {
        for (let package of source?.packages??[]) if (show_hidden||!(package.hidden||package.lib)) if (filter_all?filters.every(f=>f(package)):filters.some(f=>f(package))) {
            if (
                gid.test(package.id) &&
                ( sys == null || (package?.os??['*']).some(s=>glob(s).test(sys)) )
            ) {
                if (!array) return package;
                matches.push(package);
            }
    }
    }
    return array?matches:undefined;
}

const rep_var = (str,env) => str.replace(/\$[\w-]*\$/g,e=>env[e.slice(1,-1)]||'');

const download_package = async pack => {
    let origin = pack[OriginSymbol];
    if (origin.install_kind == 'http') {
        let url = new URL(rep_var(origin.install_href,{'package-id':pack.id}),origin.db_href);
        let res = await fetch(url);
        if (res.status == 200) return await res.text();
        return { error : 'Package wasn\'t found.' };
    }
    return { error : `Unknown installation method \`${origin.install_kind}\`.` };
}

let found = false;

const OriginSymbol = Symbol('package_origin');

if (args[0] == 'pack') {
    let p = path.resolve(args[1]||'.');
    let pkg = package(p,{
        encoding:'base64',
        update: (opt,...args) => {
            if (opt == 'scan') {
                let scan = args[0];
                process.stderr.write(`[SCAN]  ${scan.dirs.length} folders - ${scan.files.length} files\n`)
            }
            if (opt == 'embed') {
                let f = args[0];
                process.stderr.write(`\x1b[G[EMBED] (${f.processed}/${f.total}) (${(f.processed/f.total*100).toFixed(2)}%) \``+f.path+`\`\x1b[K`);
            }
            if (opt == 'end') {
                process.stderr.write(`\n`);
            }
        }
    });
    if (args[2]=='-')
        process.stdout.write(pkg);
    else
        fs.writeFileSync(args[2]||`${path.basename(p)}.cpmpackage.json`,pkg);
    process.exit(0);
}

else if (args[0] == 'unpack') {
    if (args.length == 1) {
        console.error('Missing required argument <file>.');
        process.exit(1);
    }
    let p = path.resolve(args[1]);
    let ep = args[2] || path.basename(p).match(/^[^\.]+/)?.[0];
    if (!ep) {
        console.error('Invalid unpack destination.'+(args[2]?'':' (could not deduce from file name)'));
        process.exit(1);
    }
    if (fs.existsSync(ep) && !(flags['force']||flags['f'])) {
        console.error('Unpack target already exists (use -f to merge anyways).');
        process.exit(1);
    }
    ep = path.resolve(ep);
    let pkg;
    try {
        if (args[1] == '-')
            pkg = process.stdin.read().toString('utf-8');
        else
            pkg = fs.readFileSync(p,'utf-8');
    } catch (e) {
        if (e instanceof Error && e.code == 'ENOENT') {
            console.error(`No such file or directory \`${p}\``);
            process.exit(1);
        } else {
            console.error(e);
            process.exit(1);
        }
    }
    try {
        unpackage(pkg,ep,{update:(opt,...args)=>{
            if (opt == 'tree') {
                let [fc] = args;
                process.stdout.write(`[FILE] (${0}/${fc})`);
            }
            if (opt == 'file') {
                let [file,fi,fc] = args;
                process.stdout.write(`\x1b[G[FILE] (${fi}/${fc}) ${file}\x1b[K`);
            }
            if (opt == 'end') {
                process.stdout.write(`\n`);
            }
        }});
    } catch (e) {
        if (e instanceof SyntaxError) {
            console.error('The provided file is not a valid JSON file.');
            process.exit(1);
        } else {
            console.error(e);
            process.exit(1);
        }
    }
    process.exit(0);
}

else if (args[0] == 'appdata') {
    process.stdout.write(appdata);
    process.exit(0);
}

else if (args[0] == 'update') {
    ;(async()=>{
        process.stdout.write('Reading package source index...');
        let source = JSON.parse(fs.readFileSync(path.join(appdata,'source.json')));
        let db = [];
        let si = 0;
        for (let s of source) {
            si++;
            if (s.db_kind == 'http') {
                process.stdout.write(`\x1b[GDownloading (${si}/${source.length}) ${s.db_href}\x1b[K`);
                let res = await fetch(s.db_href);
                if (res.status == 200) {
                    let rdb = await res.json();
                    db.push(Object.assign({},s,rdb));
                }
            }
        }
        process.stdout.write(`\x1b[GUpdated package index.\x1b[K\n`);
        fs.writeFileSync(path.join(appdata,'db.json'),JSON.stringify(db));
        process.exit(0);
    })();
    found = true;
}

else if (args[0] == 'list') {
    let filters = [];
    let filter_all = true;
    let show_hidden = false;
    let only_libs = false;
    for (let [flag,value] of Object.entries(flags)) {
        if (flag == 'id') {
            let g = glob(value);
            filters.push(pack=>g.test(pack.id));
        }
        else if (flag == 'version') {
            let g = glob(value);
            filters.push(pack=>g.test(pack.version));
        }
        else if (flag == 'installed') {
            filters.push(pack=>installed.includes(pack?.id));
        }
        else if (flag == 'filter-any') filter_all = false;
        else if (flag == 'filter-all') filter_all = true;
        else if (flag == 'show-hidden') show_hidden = true;
        else if (flag == 'lib') only_libs = true;
        else {
            process.stderr.write(`Unrecognized option \`${flag}\`.`);
            process.exit(1);
        }
    }
    process.stdout.write('Reading package list...');
    let db = JSON.parse(fs.readFileSync(path.join(appdata,'db.json'),'utf-8'));
    let installed = JSON.parse(fs.readFileSync(path.join(appdata,'local.json'),'utf-8')).map(p=>p.id);
    process.stdout.write('\x1b[G\x1b[K');
    for (let source of db) {
        for (let package of source?.packages??[]) if (only_libs?package.lib:((!show_hidden||!package.hidden)&&!package.lib)) if (filter_all?filters.every(f=>f(package)):filters.some(f=>f(package))) {
            process.stdout.write(`${source?.db_name?`\x1b[35m${source.db_name}/\x1b[39m`:''}${package?.id}${package?.name?` \x1b[90m${package.name}\x1b[39m`:''} \x1b[32m${package?.version}\x1b[39m${package?.virtual?' \x1b[34m(virtual)\x1b[39m':''}${installed.includes(package?.id)?' \x1b[36m[installed]\x1b[39m':''}\n    ${(package?.description??'').replace(/\n/g,'\n    ')}\n`);
        }
    }
    process.exit(0);
}

else if (args[0] == 'install') {
    if (args.length == 1) {
        process.stderr.write('Please provide a package to install.');
        process.exit(1);
    }
    let package_name = glob(args[1]);
    process.stdout.write('Reading package list...');
    let db = JSON.parse(fs.readFileSync(path.join(appdata,'db.json'),'utf-8'));
    let installed = JSON.parse(fs.readFileSync(path.join(appdata,'local.json'),'utf-8'));
    process.stdout.write('\x1b[G\x1b[K');
    let candidates = [];
    for (let source of db) {
        for (let package of source?.packages??[]) {
            Object.assign(package,{[OriginSymbol]:source});
            if (package_name.test(package?.id)) candidates.push(package);
        }
    }
    if (!candidates.length) {
        process.stderr.write('Could not find a package corresponding to the specified ID');
        process.exit(1);
    }
    if (candidates.length == 1) {
        ;(async()=>{
            let package = candidates[0];
            let dependencies = [];
            let d = package?.dependencies??[];
            let di = [];
            let depstack = Object.fromEntries(d.map(({id:i})=>[i,[package.id]]));
            process.stdout.write(`Resolving dependencies...`);
            while (d.length) {
                let nd = [];
                for (let dep of d) {
                    if (typeof dep?.id=='string'&&!di.includes(dep.id)&&(flags['replace']||(!installed.some(i=>i.id==dep.id&&(!dep.version||i.version==dep.version)))||!dep.version)) {
                        let pkg = find_package(dep.id,{db,installed,sys});
                        if (!pkg) {
                            process.stdout.write('\x1b[G\x1b[K');
                            process.stderr.write(`Failed to resolve dependencies : Unable to locate package \`${dep.id}\`\n    (dependency trace: ${depstack[dep.id].join('>')}>${dep.id})`);
                            process.exit(1);
                        }
                        for (let pdep of pkg?.dependencies??[]) {
                            depstack[pdep.id] = depstack[dep.id].concat([dep.id]);
                            nd.push(pdep);
                        }
                        dependencies.push(pkg);
                        di.push(pkg.id);
                    }
                }
                d = nd;
            }
            process.stdout.write(`\x1b[G\x1b[K`);
            process.stdout.write(`Packages (${dependencies.length+1}):\n`);
            process.stdout.write(` ${installed.includes(package?.id)?'\x1b[36m#\x1b[39m':''} \x1b[35m${package?.id}\x1b[39m \x1b[32m${package?.version}\x1b[39m ${package?.virtual?'\x1b[34m(virtual)\x1b[39m':''}\n`);
            for (let p of dependencies) {
                process.stdout.write(` ${installed.includes(package?.id)?'\x1b[36m#\x1b[39m':''} \x1b[35m${p?.id}\x1b[39m \x1b[32m${p?.version}\x1b[39m ${p?.virtual?'\x1b[34m(virtual)\x1b[39m':''}\n`);
            }
            const rl = readline.createInterface(process.stdin,process.stdout);
            if (!(flags['yes']||flags['y'])) {
                let val = (await rl.question('Install? [Y/n] ')).toLocaleLowerCase()||'y';
                if (val != 'y') process.exit(0);
            }
            process.stdout.write('\x1b[A\x1b[G\x1b[K'.repeat(dependencies.length+3));
            dependencies.reverse();
            dependencies.push(package);
            let ml = dependencies.map(d=>d.id.length).reduce((a,b)=>Math.max(a,b),0);
            for (let pack of dependencies) {
                process.stdout.write(`\x1b[35m${pack.id}\x1b[39m${' '.repeat(ml-pack.id.length)} \x1b[90mPending...\x1b[39m\n`);
            }
            process.stdout.write('\x1b[A'.repeat(dependencies.length));
            let pi = 0;
            for (let pack of dependencies) {
                process.stdout.write(`\x1b[G\x1b[K\x1b[35m${pack.id}\x1b[39m${' '.repeat(ml-pack.id.length)} Downloading...`);
                let rpkg = await download_package(pack);
                if (rpkg.error) {
                    process.stdout.write(`\x1b[G\x1b[K\x1b[35m${pack.id}\x1b[39m${' '.repeat(ml-pack.id.length)} \x1b[31mFailed\x1b[39m.`);
                    process.stdout.write(`\x1b[B`.repeat(dependencies.length-pi)+`\x1b[G`);
                    process.stderr.write(`Failed to download \`${pack.id}\`: ${rpkg.error}`);
                    process.exit(1);
                }
                process.stdout.write(`\x1b[G\x1b[K\x1b[35m${pack.id}\x1b[39m${' '.repeat(ml-pack.id.length)} Extracting...`);
                let cfg = Object.assign({},default_cfg,get_package_cfg(rpkg));
                let install_path = path.resolve(rep_var(cfg?.installPath,{'appdata':appdata,'package-id':pack.id,'temp':'$temp$','cwd':process.cwd()}));
                let temp = false;
                install_path.replace(/\$temp\$/,()=>(temp=true,fs.mkdtempSync(path.join(os.tmpdir()+path.sep))+'-cpm-'+pack.id));
                fs.mkdirSync(install_path,{recursive:true});
                unpackage(rpkg,install_path);
                process.stdout.write(`\x1b[G\x1b[K\x1b[35m${pack.id}\x1b[39m${' '.repeat(ml-pack.id.length)} Installing...`);
                if (cfg?.installScript) {
                    let exitCode = null;
                    let stdout = null
                    let stderr = null;
                    let timeout = false;
                    let proc = cp.exec(cfg.installScript,(err,pstdout,pstderr)=>{
                        exitCode = proc.exitCode;
                        stdout = pstdout;
                        stderr = pstderr;
                    });
                    await new Promise(r=>{let i=setInterval(()=>{if(exitCode!=null){clearInterval(i);clearTimeout(t);r()}});let t=setTimeout(()=>{clearInterval(i);timeout=true;r()},300_000)});
                    if (exitCode != 0 || timeout) {
                        process.stdout.write(`\x1b[G\x1b[K\x1b[35m${pack.id}\x1b[39m${' '.repeat(ml-pack.id.length)} \x1b[31mFailed\x1b[39m.`);
                        process.stdout.write(`\x1b[B`.repeat(dependencies.length-pi)+`\x1b[G`);
                        process.stderr.write(`Failed to install \`${pack.id}\`: ${timeout?'Install timed out after 5 minutes.':'\n    '+(stderr??'<CPM ERROR>').replace(/\n/g,'\n    ')}`);
                        process.exit(1);
                    }
                }
                if (Array.isArray(cfg?.bin)) {
                    for (let bin of cfg.bin) {
                        if (typeof bin.cmd=='string') if ((bin.os??['*']).some(s=>glob(s).test(sys))) {
                            let bin_name = bin.name+(os.platform()=='win32'?'.bat':'').replace(/\.bat\.bat$/,'.bat');
                            let bin_path = path.resolve(path.join(appdata,'.bin',bin_name));
                            if (fs.existsSync(bin_path)) {
                                let bins = JSON.parse(fs.readFileSync(path.join(appdata,'bins.json')));
                                let b = bins.find(b=>b.name==bin_name&&b.id!=pack.id);
                                let cancel = false;
                                if (b||bin_path==cpmbin) {
                                    process.stdout.write(`\x1b[G\x1b[K\x1b[35m${pack.id}\x1b[39m${' '.repeat(ml-pack.id.length)} \x1b[33mStopped\x1b[39m...`);
                                    process.stdout.write(`\x1b[B`.repeat(dependencies.length-pi)+`\x1b[G`);
                                    if (bin_path==cpmbin) {
                                        // Maybe throw an error, idk
                                    } else {
                                        let val = (await rl.question(`Overwrite binary file \`${bin_name}\` created by \`${b.id}\` [y/N] `)).toLocaleLowerCase()||'n';
                                        cancel = val != 'y';
                                    }
                                }
                                if (cancel) continue;
                            }
                            if (process.platform == 'win32')
                                fs.writeFileSync(bin_path,`@echo off\n`+bin.cmd?.replace(/\%package_path\%/g,install_path),'utf-8');
                            else {
                                fs.writeFileSync(bin_path,'#!/usr/bin/env bash\n'+bin.cmd?.replace(/\%package_path\%/g,install_path),'utf-8');
                                fs.chmodSync(bin_path,bin.mod??0o744);
                            }
                            let bins = JSON.parse(fs.readFileSync(path.join(appdata,'bins.json')));
                            let bi = bins.findIndex(b=>b.name==bin_name);
                            if (bi != -1) bins[bi].id = pack.id;
                            else bins.push({name:bin_name,id:pack.id});
                            fs.writeFileSync(path.join(appdata,'bins.json'),JSON.stringify(bins),'utf8');
                        }
                    }
                }
                process.stdout.write(`\x1b[G\x1b[K\x1b[35m${pack.id}\x1b[39m${' '.repeat(ml-pack.id.length)} Cleaning up...`);
                if (temp) fs.rmSync(install_path,{force:true,recursive:true,maxRetries:5});
                if (!cfg?.local) {
                    let db = JSON.parse(fs.readFileSync(path.join(appdata,'local.json'),'utf-8'));
                    let eid = db.findIndex(e=>e.id==pack.id);
                    if (eid == -1) db.push(pack);
                    else db[eid] = pack;
                    fs.writeFileSync(path.join(appdata,'local.json'),JSON.stringify(db));
                }
                process.stdout.write(`\x1b[G\x1b[K\x1b[35m${pack.id}\x1b[39m${' '.repeat(ml-pack.id.length)} Installed.\n`);
                pi++;
            }
            process.exit(0);
        })();
    } else {
        process.stdout.write(`Found candidates:\n`);
        for (let package of candidates) {
            process.stdout.write(`${package?.name} \x1b[35m${package?.id?`(${package.id})`:``}\x1b[39m \x1b[32m${package?.version}\x1b[39m ${package?.virtual?'\x1b[34m(virtual)\x1b[39m':''}\n     ${(package?.description??'').replace(/^(.{0,100})(.+)?$/,(_,a,b)=>a+(b?'...':'')).replace(/\n/g,'\n     ')}\n`);
        }
    }
    
    found = true;
}

else if (args[0] == 'source') {
    if (args[1] == 'add') {
        let source = JSON.parse(fs.readFileSync(path.join(appdata,'source.json'),'utf-8'));
        let src = {};
        for (let [f,v] of Object.entries(flags)) {
            if (f == 'kind') src['db_kind'] = v;
            if (f == 'href') src['db_href'] = v;
            if (f == 'name') src['db_name'] = v;
        }
        source.push(src);
        fs.writeFileSync(path.join(appdata,'source.json'),JSON.stringify(source),'utf-8');
        process.exit(0);
    } else {
        process.stderr.write(`Unknown source action \`${args[1]}\``);
        process.exit(1);
    }
}

else if (args[0] == 'home') {
    console.log(appdata);
    process.exit(0);
}

else if (args[0] == 'upload') {
    throw Error('Not implemented');
}

if (!found) {

    if (args[0]) {
        process.stdout.write(`Unknown command \`${args[0]}\`.`);
        process.exit(1);
    } else {
        process.stdout.write(`Please provide a command to run.`);
        process.exit(2);
    }

}