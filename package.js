// Pakcages an entire folder inside of a single json file, compressing most of it
// Also allows unpackaging a packaged folder

const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const crypto = require('node:crypto');

const glob = require('glob-to-regexp');

const hash = d => crypto.createHash('md5-hex').update(d).digest();

const raw_paths = [
    '/.cpmpkg'
];

const ignore_paths = [
    '/*.cpmpackage.json',
    '/node_modules/*',
    '/.git/*'
];

const compressors = {
    'deflate' : zlib.deflateSync,
};

const decompressors = {
    'deflate' : zlib.inflateSync,
};

/** @type {Object<string,(buf:zlib.InputType,callback:zlib.CompressCallback)=>void>} */
const decompressors_async = {
    'deflate' : zlib.inflate
};

const package_settings = {
    compressor:'deflate',
    options:{},
    encoding:'base64',
    update:()=>{},
};

const unpackage_settings = {
    compressor:null,
    encoding:null,
    update:()=>{},
};

/**
 * @typedef PackageCompressor
 * @type {'deflate'}
 */

/** 
 * @typedef PackageOptions
 * @property {PackageCompressor} compressor
 * @property {zlib.ZlibOptions} options
 * @property {BufferEncoding} encoding
 * @property {()=>void} update
 */

/**
 * @typedef UnpackageOptions
 * @property {()=>void} update
 * @property {BufferEncoding|null} encoding Either an encoding to overwrite the package's encoding, or `null` (default) to use the default package encoding
 */

/**
 * @param {string} root The root folder
 * @param {PackageOptions=} settings The settings
 */
function package(root,settings) {
    settings = Object.assign({},package_settings,settings||{});
    let ip = [...ignore_paths,...settings?.ignore_paths??[]];
    let rp = [...raw_paths,...settings?.raw_paths??[]];
    const should_ignore = p => ip.some(pp=>glob(pp,{extended:true}).test(p));
    const should_raw = p => rp.some(pp=>glob(pp,{extended:true}).test(p));
    let compressor = compressors[settings?.compressor];
    let state = [root];
    let dirs = [];
    let filez = [];
    let raw_files = {};
    let compressed_files = {};
    let pkgcfg = fs.existsSync(path.join(root,'.cpmpkg'))?JSON.parse(fs.readFileSync(path.join(root,'.cpmpkg'),'utf-8')):{};
    let pkginclude = p => (pkgcfg?.include?.length?pkgcfg?.include?.some(pp=>glob(pp).test(p)):true)&&!(pkgcfg?.exclude?.length?pkgcfg?.exclude?.some(pp=>glob(pp).test(p)):false);
    while (state.length) {
        let nstate = [];
        for (let s of state) {
            for (let f of fs.readdirSync(s)) {
                let fp = path.posix.join(s,f);
                let rp = path.posix.relative(root,fp);
                let stat = fs.statSync(fp);
                if (stat.isDirectory() && !should_ignore('/'+rp+'/') && pkginclude(rp)) {
                    dirs.push(rp);
                    nstate.push(fp);
                    settings?.update?.('dir',rp,fp,filez.length,dirs.length);
                } else if (stat.isFile() && !should_ignore('/'+rp) && pkginclude(rp)) {
                    filez.push([rp,fp]);
                    settings?.update?.('file',rp,fp,filez.length,dirs.length);
                }
            }
        }
        state = nstate;
    }
    settings?.update?.('scan',{files:filez,dirs});
    let fi = 0;
    for (let [rp,fp] of filez) {
        fi++;
        if (should_raw('/'+rp)) {
            let file = fs.readFileSync(fp);
            let final = raw_files[rp] = file.toString(settings?.encoding);
            settings?.update?.('embed',{total:filez.length,processed:fi,path:rp,abs:fp,comprssed:false,size0:file.length,size1:new Blob([final]).size});
        } else {
            let file = fs.readFileSync(fp);
            let final = compressed_files[rp] = compressor?.(file,settings?.options).toString(settings?.encoding);
            settings?.update?.('embed',{total:filez.length,processed:fi,path:rp,abs:fp,compressed:true,size0:file.length,size1:new Blob([final]).size});
        }
    }
    settings?.update?.('end',{});
    return JSON.stringify({settings:{encoding:settings?.encoding,compressor:settings?.compressor},dirs,files:{raw:raw_files,compressed:compressed_files}});
    // return JSON.stringify({dirs,files:{raw:raw_files,compressed:settings.compressor(JSON.stringify(compressed_files),settings.options).toString(settings.encoding)}});
}

/**
 * @param {string} package The package itself
 * @param {string} destination The folder to unpackage into
 * @param {UnpackageOptions} settings
 */
function unpackage(package,destination,settings={}) {
    settings = Object.assign({},unpackage_settings,settings||{});
    let encoding = settings?.encoding;
    let compressor = settings?.compressor;
    package = JSON.parse(package);
    fs.mkdirSync(destination,{recursive:true});
    for (let d of package?.dirs??[]) {
        settings?.update?.('dir',d);
        fs.mkdirSync(path.join(destination,d),{recursive:true});
    }
    encoding = encoding != null ? encoding : (package?.settings?.encoding || package_settings.encoding);
    compressor = compressor != null ? compressor : (package?.settings?.compressor || package_settings.compressor);
    let fc = Object.entries(package?.files?.raw??{}).length + Object.entries(package?.files?.compressed??{}).length;
    settings?.update?.('tree',fc);
    let fi = 0;
    for (let [f,contents] of Object.entries(package?.files?.raw??{})) {
        fi++;
        let p = path.join(destination,f);
        let buff = Buffer.from(contents,encoding);
        fs.writeFileSync(p,buff);
        settings?.update?.('file',f,fi,fc,null,buff.length,new Blob([contents]).size);
    }
    for (let [f,contents] of Object.entries(package?.files?.compressed??{})) {
        fi++;
        let p = path.join(destination,f);
        let buff = Buffer.from(contents,encoding);
        let final = decompressors[compressor](buff);
        fs.writeFileSync(p,final);
        settings?.update?.('file',f,fi,fc,new Blob([final]).size,buff.length,new Blob([contents]).size);
    }
}

/**
 * @param {string} package The package itself
 * @param {UnpackageOptions} settings
 */
function unpackage_async(package,settings) {
    settings = Object.assign({},unpackage_settings,settings||{});
    let encoding = settings?.encoding;
    let compressor = settings?.compressor;
    package = JSON.parse(package);
    for (let d of package?.dirs??[]) settings?.update?.('dir',d);
    encoding = encoding != null ? encoding : (package?.settings?.encoding || package_settings.encoding);
    compressor = compressor != null ? compressor : (package?.settings?.compressor || package_settings.compressor);
    settings?.update?.('tree');
    for (let [f,contents] of Object.entries(package?.files?.raw??{})) {
        settings?.update?.('data',Buffer.from(contents,encoding),f);
    }
    let fi = Object.entries(package?.files?.compressed??{}).length;
    for (let [f,contents] of Object.entries(package?.files?.compressed??{})) {
        decompressors_async[compressor](Buffer.from(contents,encoding),(err,res)=>{
            if (err) {
                settings?.update?.('error',f);
            } else {
                settings?.update?.('data',res.toString(encoding),f);
            }
            fi--;
        });
    }
    return new Promise(resolve=>{
        let i = setInterval(
            () => {
                if (!fi) {
                    clearInterval(i);
                    resolve();
                }
            }
        )
    });
}

/**
 * Turns a package into an object with the pre-configured database JSON data and stripped package data
 */
function bundle_package(pack) {
    let package = JSON.parse(pack);
    let rawcfgfile = package?.files?.raw?.['.cpmpkg'];
    if (!rawcfgfile) return { error : 'Unable to locate package data.' };
    let cfgfile = JSON.parse(Buffer.from(rawcfgfile,package?.settings?.encoding).toString('utf-8'));
    return {
        db : {
            name         : cfgfile?.name         ?? '<package name>',
            description  : cfgfile?.description  ?? '',
            tags         : cfgfile?.tags         ?? [],
            author       : cfgfile?.author       ?? [],
            dependencies : cfgfile?.dependencies ?? [],
            os           : cfgfile?.os           ?? ['*'],
            alternarive  : cfgfile?.alternarive  ?? [],
            version      : cfgfile?.version      ?? '0.0.0'
        },
        package : JSON.stringify(package)
    };
}

/**
 * Returns the package's configuration file in JSON
 * @param {string} pkg
 * @returns {object}
 */
function get_package_cfg(pkg) {
    let jpkg = JSON.parse(pkg);
    return JSON.parse(Buffer.from(jpkg?.files?.raw?.['.cpmpkg'],jpkg?.settings?.encoding)?.toString('utf-8'));
}

module.exports = { package, unpackage, unpackage_async, bundle_package, get_package_cfg }