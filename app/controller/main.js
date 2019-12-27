//First get Config
const Config = require('electron-config');
const config = new Config({
    defaults: 
    {
        navbarcolor: 'blue',
        cflocation: '/Applications/ColdFusion11',
        propprefix: 'uriworkermap.',
        vhpermissions: true
    }
});

//Set navbar color
if(config.get('navbarcolor') != 'blue')
    $('#navbar-main').removeClass('blue').addClass(config.get('navbarcolor'));    

//Require
const electron = require('electron');
const app = electron.remote.app;
const remote = electron.remote;
const dialog = remote.dialog;
const fs = require('fs');
const ini = require('ini');
const {exec,execSync} = require('child_process');
const hostile = require('hostile');
const sudo = require('sudo-prompt');
const crypto = require('crypto');
const request = require('request').defaults({jar: true});

//Debug
const {ipcRenderer} = require('electron');
ipcRenderer.on('message', function(event, text) {
  console.log('Updater->'+text);
})

//Vars
//var CFPath = "/Applications/ColdFusion11";
var CFPath = config.get('cflocation');
var CFConfigPath = CFPath + "/config";
var CFProperties = CFConfigPath + "/wsconfig/1/";
var vhostpath = "/private/etc/apache2/extra/httpd-vhosts.conf";
var httpdconf = "/private/etc/apache2/httpd.conf";
var HostsPath = "/etc/hosts";
var LoggedUser = execSync(`sudo stat -f "%Su" /dev/console`,{encoding:"utf8"}).trim();

var LoaderHTML = 
`
 <div class="preloader-wrapper big active">
    <div class="spinner-layer spinner-blue-only">
      <div class="circle-clipper left">
        <div class="circle"></div>
      </div><div class="gap-patch">
        <div class="circle"></div>
      </div><div class="circle-clipper right">
        <div class="circle"></div>
      </div>
    </div>
  </div>  
`;

$.LoadingOverlaySetup({
    image           : "",
    custom          : LoaderHTML
});

var options = {
  name: 'Coldfusion Instance Manager',
  ///../misc/prototype.properties
  icns: __dirname + '/../resources/electron.icns', // (optional)
};

//Main

var RTimer = setInterval(function(){
    RefreshStatus();
}, 60000);

//Document Ready
$(function() 
{
    $('.tooltipped').tooltip({
        delay: 50,
        position: 'top'
    });
    //RefreshStatus();
    $(".button-collapse").sideNav({
        closeOnClick: true
    });
    $('.modal').modal({
      ready: function(modal, trigger) { 
        $(this).find("[autofocus]").first().focus();
      }
    });

    //Decide whether to use mod_jk or httpd-vhosts.conf
    CheckForVhost();

    //Check if CF was installed
    if(!FileExist(CFConfigPath,true))
    {
        Materialize.toast('ColdFusion installation not found', 99000,"red");
        throw("332 CF Not found");
        //alert("Coldfusion installation was not found.");        
    }

    CheckForCFusion();

    LoadTable();    
});

function CheckForCFusion()
{
    if(getVHostbyServerName('localhost') == 'NULL')
    {
        var toastbtn = $('<button class="btn-flat toast-action red white-text">Fix</button>').
        click(function(e)
        {
            var NewVHost = fs.readFileSync(__dirname + '/../misc/prototype.vhostlocal','utf8');
            fs.appendFileSync(vhostpath, "\n" + NewVHost);
            RestartApache();
            $(this).parents('.toast')[0].remove();   
        });
        var $toastContent = $('<span>No virtualhost entry for localhost was found</span>').append(toastbtn);
        Materialize.toast($toastContent, 99000);
    }    
}


/**
 * Gets the VirtualHost of the instance.
 * 
 * @param {String} id - Server Name
 * @returns {String} - Apache VirtualHost
 */
function getVHostbyServerName(id)
{
    var VList = getVHostList();

    if(!VList) return "NULL";

    var result = VList.find(function(item)
    {
        //Search by JKMountFile
        var re = new RegExp(/ServerName\s?([^\n*]+)/,'ig');
        var Elements = getMatches(item,re,1);
        if(Elements.length > 0 && Elements[0].includes(id))
        {
            return item.trim();
        }  
    })

    if(typeof result === 'undefined')
        return "NULL"

    return result;
}


/**
 * Decides where to store/read Virtualhosts
 */
function CheckForVhost()
{
    var httpdfile = fs.readFileSync(httpdconf, 'utf-8');
    var search = httpdfile.replace(/#[\w\s\'].*/g,'')

    if(!search.match(/Include \/private\/etc\/apache2\/extra\/httpd-vhosts.conf/ig))
    {
        vhostpath = '/private/etc/apache2/mod_jk.conf';
    }
}

/**
 * Checks if instance is on the worker list.
 * 
 * @param {String} id - Coldfusion Instance
 * @returns {boolean} - true or false
 */
function isOnWorkerList(id)
{
    var config = getWorkerConfig();
    var WorkerList = config['worker.list'].split(',');
    WorkerList = WorkerList.map(function(x){ return x.toUpperCase() });

    return WorkerList.includes(id.toUpperCase());
}

/**
 * Gets the content of the worker.properties file.
 * 
 * @returns {Array} - Array with the content of worker.properties
 */
function getWorkerConfig()
{
    return ini.parse(fs.readFileSync(CFProperties+'workers.properties', 'utf-8'))
}

/**
 * Commits changes made to the worker.properties file.
 * 
 * @param {Array} newconfig - Array with the content of worker.properties
 */
function SaveWorkerConfig(newconfig)
{
    fs.writeFileSync(CFProperties+'workers.properties', ini.stringify(newconfig, {}));
}

/**
 * Display instances data on main table.
 * It autorefresh the status of the instance at completion.
 */
function LoadTable()
{
    var Instances = getCFIDList();
    var tbody = document.getElementById("rows");

    Instances.forEach(function(cItem)
    {
        let tr = createIRow(cItem);
        AddIRow(tr);
    });

    RefreshStatus(true);
}

/**
 * Get the Java port of the specified instance
 * 
 * @param {any} id 
 * @returns 
 */
function getJavaPort(id)
{
    var jvmconfig = CFPath+"/"+id+"/bin/jvm.config";
    if(!FileExist(jvmconfig,true))
        return "NULL";
    
    jvmconfig = fs.readFileSync(jvmconfig,'utf-8');
    var result = jvmconfig.match(/address=([^\s]+)/i);
    if(result && result.length > 1)
        return result[1];
    
    return "NULL";
}

/**
 * Sets a new JAVA port to the Instance
 * 
 * @param {any} id 
 * @param {any} port 
 */
function setJavaPort(id,port)
{
    if(port == "NULL") 
    {
        console.error("631 :: Trying to set NULL the JavaPort")
        return;
    }        
    
    var jvmconfig = CFPath+"/"+id+"/bin/jvm.config";
    if(!FileExist(jvmconfig))
        return "NULL";

    var jvmFile = fs.readFileSync(jvmconfig,'utf-8');
    fs.writeFileSync(jvmconfig,jvmFile.replace("address="+getJavaPort(id),"address=" + port),{});
}

/**
 * Generate a unique Port for the instance
 * 
 * @returns {Number} - Port Number
 */
function getUniqueJVMPort()
{
    var JVMList = getJVMPortList();
    var CurrentPort = JVMList[0];

    while(JVMList.includes(String(CurrentPort)))
    {
        CurrentPort++;
    }

    return CurrentPort;
}

/**
 * Appends a row element into table body.
 * 
 * @param {HTMLElement} row - Row element
 */
function AddIRow(row)
{
    var tbody = document.getElementById("rows");
    tbody.appendChild(row);
}

/**
 * Creates a row element.
 * 
 * @param {String} cItem - Instance ID
 * @returns {HTMLElement} - Table row
 */
function createIRow(cItem)
{
        // Create row
        let tr = document.createElement("tr");

        //Set unique id
        tr.id = 'row_'+cItem.toLowerCase();

        //Create nodes
        let cf_id   = document.createElement("td");
        let cf_port = document.createElement("td");
        let status = document.createElement("td");
        let buttons = document.createElement("td");
        let ldr = document.createElement("td");        

        // Set Data
        cf_id.innerHTML = cItem;
        cItem = cItem.toLocaleLowerCase();
        cf_port.innerHTML = getRemotePort(cItem);
        $(cf_port).addClass("center");
        status.innerHTML = 
        `   
        <div class="switch center">
            <label>
            Off
            <input class="ck_status" 
                   id="status_${cItem}" 
                   data-id="${cItem}" 
                   type="checkbox">
            <span class="lever"></span>            
            On           
            </label>             
        </div>               
        `
        $(ldr).attr('style','width: 35px');
        ldr.innerHTML = 
        `
        <div class="preloader-wrapper active center" id="ldr_${cItem}" 
                style="width:26px;height:26px;float:right;display:none">
            <div class="spinner-layer spinner-green-only">
            <div class="circle-clipper left">
                <div class="circle"></div>
            </div><div class="gap-patch">
                <div class="circle"></div>
            </div><div class="circle-clipper right">
                <div class="circle"></div>
            </div>
            </div>
        </div>                
        `
        var url = getIURL(cItem);
        if(cItem == "cfusion") url = "localhost";
        
        url = (url != "") ? "http://" + url : "";
        buttons.innerHTML = 
        `
        <div class="center noselect">
        <a href="${url}" id="btn_home_${cItem}" class="btn-floating disabled btns_${cItem}"><i class="material-icons">home</i></a>
        <a href="${url}/CFIDE/administrator/index.cfm" 
           class="btn-floating disabled btns_${cItem}">
           <i class="material-icons">build</i>
        </a>
        <a id="btnedit_${cItem}" class="btn-floating"><i class="material-icons">edit</i></a>
        </div>
        `
        
        //Events
        let btnEdit = $(buttons).find("#btnedit_"+cItem).click
        (
            function()
            {
                ShowEditItem(cItem);
            }
        );

        let ckStatus = $(status).find('.ck_status').change
        (
            function()
            {
                StatusChange(this);
            }
        );

        if(cItem == "cfusion") 
        {
            $(btnEdit).addClass("disabled");
        }
        
        //Append to table row
        tr.appendChild(cf_id);
        tr.appendChild(cf_port);
        tr.appendChild(status);
        tr.appendChild(ldr);
        tr.appendChild(buttons);

        return tr;
}

/**
 * Check if a file exist. Currently cached.
 * 
 * @param {String} path - Path to file
 * @param {Boolean} bForce - Whether to Ignore cache or not
 * @returns {boolean} - true or false
 */
function FileExist(path,bForce)
{
    //Testing speed
    //if(bForce)
    //{
        return fs.existsSync(path);
    //}
    
    //return true;
}

//Gets
/**
 * Gets a list with all ColdFusion Instances
 * 
 * @returns {Array} Array with all CF Instances
 */
function getCFIDList()
{ 
    var xmlFile = CFConfigPath + "/instances.xml";
    // Check if file exist.
    if(!FileExist(xmlFile))
    {
        alert("Instances.xml was not found.");
        throw("334 Inst.xml not found");
    }
    //Get file
    var xmlFile = fs.readFileSync(xmlFile,'utf-8');
    var parser = new DOMParser();
    var xmlDoc = parser.parseFromString(xmlFile,"text/xml");

    var List = [];
    var Elements = xmlDoc.getElementsByTagName("name");

    for (var i = 0; i < Elements.length; i++) 
    {
        List.push(Elements[i].innerHTML.trim());
    }

    return List;
}

/**
 * Gets the Remote Port for the specified instance
 * 
 * @param {String} id - Instance ID
 * @returns {Number} - Port number; returns "NULL" if operation failed.
 */
function getRemotePort(id)
{
    var cfserverxml = CFPath+"/"+id+"/runtime/conf/server.xml";
    if(!FileExist(cfserverxml))
        return "NULL";
    
    var cfserverxml = fs.readFileSync(cfserverxml,'utf-8');
    var Elements = $(cfserverxml).find("connector");
    //return Elements.attr("port");
    let Port = "NULL";
    Elements.each(function()
    {
        if($(this).attr('tomcatAuthentication'))
        {
            Port = $(this).attr("port");
            return false;
        }
    })
    return Port;    
}

/**
 * Gets HTTP port for specified instance
 * 
 * @param {String} id - Instance ID
 * @returns {Number} - Port number; returns "NULL" if operation failed.
 */
function getHTTPPort(id)
{
    if(id == "cfusion") return "";

    var cfserverxml = CFPath+"/"+id+"/runtime/conf/server.xml";
    if(!FileExist(cfserverxml))
        return "NULL";
    
    var cfserverxml = fs.readFileSync(cfserverxml,'utf-8');
    var Elements = $(cfserverxml).find("connector");
    let Port = "NULL";
    Elements.each(function()
    {
        if($(this).attr('connectionTimeout'))
        {
            Port = $(this).attr("port");
            return false;
        }
    })
    return Port;
}

/**
 * Gets the instance URL from Apache
 * 
 * @param {String} id - Instance ID
 * @returns {String} - Instance URL
 */
function getIURL(id)
{
    var InstanceHost = getVHost(id);

    if(InstanceHost == "NULL") return "";

    var re = new RegExp(/ServerName\s?([^\n*]+)/,'ig');
    var Elements = getMatches(InstanceHost,re,1);
    if(Elements.length > 0)
        return Elements[0];
    
    return "";
}

/**
 * Gets the instance WWW folder path.
 * 
 * @param {String} id - Instance ID
 * @returns {String} - WWW Folder Path
 */
function getIPath(id)
{
    var InstanceHost = getVHost(id);

    if(InstanceHost == "NULL") return "";

    var re = new RegExp(/DocumentRoot\s?([^\n*]+)/,'ig');
    var Elements = getMatches(InstanceHost,re,1);
    if(Elements.length > 0)
        return Elements[0].replace(/['"]+/g, '');
    
    return "";
}

/**
 * Gets the VirtualHost of the instance.
 * 
 * @param {String} id - Instance ID
 * @returns {String} - Apache VirtualHost
 */
function getVHost(id)
{
    var VList = getVHostList();

    if(!VList) return "NULL";

    var result = VList.find(function(item)
    {
        //Search by JKMountFile
        var re = new RegExp(/JkMountFile\s?"([^"]+)"/,'ig');
        var Elements = getMatches(item,re,1);
        if(Elements.length > 0)
        {
            var filename = Elements[0].replace(/^.*[\\\/]/, '').toLowerCase();
            var PropertiesFile = getPropertiesFileName(id);
            //Check if it belogns to the instance we are looking.
            if(filename == PropertiesFile || filename == config.get('propprefix') + PropertiesFile )
            {
                //Returns the Host of the item.
                return item.trim();
            }
        }  
    })

    if(typeof result === 'undefined')
        return "NULL"

    return result;
}

/**
 * Gets a list with all the Apache Virtualhosts
 * 
 * @returns {Array} - Array of strings with all the Virtualhosts
 */
function getVHostList()
{
    var vhostfile = fs.readFileSync(vhostpath,'utf-8');
    vhostfile = vhostfile.replace(/\#.*/g,'');
    var re = new RegExp(/<virtualhost[\s\S]*?<\/virtualhost>/,'ig');
    return vhostfile.match(re);
}

/**
 * Checks if URL is on the hosts file.
 * 
 * @param {String} url - URL
 * @returns {Boolean} - true or false
 */
function isOnHostName(url)
{
    var HostArr = hostile.get(false);
    var bResult = HostArr.some(
    function(item)
    {
        return item.includes(url);
    });

    return bResult;
}

/**
 * Check if Java Port is not being used by another instance.
 * 
 * @param {String} id - Instance ID
 * @returns {Boolean} Is port valid
 */
function isJVMPortValid(id)
{
    var PortList = getJVMPortList(id);    
    var InstancePort = getJavaPort(id);
    //console.log(PortList);
    //console.log(InstancePort.toString());
    
    return !PortList.includes(InstancePort.toString());
}

/**
 * Get a list with all Java ports being used by Instances
 * 
 * @param {any} excludeid - Optional, Exlude a Instance.
 * @returns {Array} - Array with all JAVA ports.
 */
function getJVMPortList(excludeid)
{
    var IList = getCFIDList();
    var JVPortList = [];
    excludeid = excludeid || "";

    IList.forEach(function(item)
    {
        if(excludeid.toLowerCase() != item.toLowerCase())
            JVPortList.push(getJavaPort(item));
    });

    return JVPortList;
}

/**
 * Executes a command line.
 * 
 * @param {String} command - Command line
 * @param {Function} callback - Callback function
 * @param {Boolean} bAdmin - Run as Administrtor?
 * @param {String} [cfid]  - Optional, Instance ID
 * @param {Boolean} [bOnload]  - If it was executed on the 'onstart' event.
 * @returns {void}
 */
function execute(command, callback, bAdmin, cfid, bOnload)
{
    let lastState = "NULL";
    let isLoading = false;

    if(cfid) 
    {
        lastState = +$('#status_'+cfid).prop('checked');
        isLoading = $('#status_'+cfid).prop('disabled');
        //console.log("bisLoading->"+isLoading + "bOnload->"+bOnload);
        //If it is loading dont refresh.
        if(isLoading && !bOnload) return;        
    }

    if(!bAdmin)
    {
        exec(command, function(error, stdout, stderr){
            if(error && stdout != "") console.log("Error->"+error);
            if(stderr) console.log("stderr->"+stderr);
            //if(command.includes('cfusion')) 
            if(lastState != "NULL" && lastState != stdout.trim())
            {
                //console.log("lastState->"+lastState);
                //console.log("stdout->"+stdout.trim());                                    
                //console.log("compare->"+(lastState != stdout));                    

                //Bad fix
                let rRetry = execSync(command,{encoding:"utf8"});
                //console.log("Retry->"+rRetry.trim());
                callback(rRetry);
                return;      
            }
            callback(stdout); 
        });
        return;
    }

    sudo.exec(command, options, 
    function(error, stdout, stderr) 
    { 
        //For some reason return object.
        error = String(error);
        stdout = String(stdout);
        
        // Detect if process failed
        var bfailed = (typeof error != 'undefined' 
                        && error.includes("User did not grant permission"));
        
        // Run callback
        callback(stdout,bfailed);
    });
}

/**
 * Enables all shortcuts buttons
 * 
 * @param {String} id - Instance ID
 */
function ShowButtons(id)
{
    $(".btns_"+id).each(function()
    {
        if($(this).attr("href") != "" && $(this).attr("href") != "http://localhost")
            $(this).removeClass("disabled");
    });    
}

/**
 * Disables all shortcuts buttons
 * 
 * @param {String} id - Instance ID
 */
function HideButtons(id)
{
    $(".btns_"+id).addClass("disabled");
}

/**
 * Refresh the status of all instances
 * 
 * @param {Boolean} bForce - Force a reload.
 */
function RefreshStatus(bForce)
{
    var Instances = getCFIDList();
    execute('ps -ef | grep "coldfusion.rootDir=/Applications/ColdFusion" | grep -v grep',
    function(output)
    {
        if(output)
        {
            //Parse output.
            var result = getMatches(output,/coldfusion\.rootDir=\/Applications\/ColdFusion11\/([^\/]*)/ig,1);
            //Change Array of instances to LowerCase
            result = result.map(function(x){ return x.toLowerCase() });
            //Look for changes
            Instances.forEach(function(cItem)
            {
                cItem = cItem.toLowerCase();
                let benabled = result.includes(cItem);
                
                if(!$("#status_"+cItem).prop("disabled") || bForce)
                {
                    //Hide loading
                    $("#ldr_"+cItem).hide();
                    //Set Status
                    $("#status_"+cItem).prop("checked",benabled);
                    //Enable input
                    $("#status_"+cItem).prop("disabled",false);  
                    //Remove css effect.
                    if(benabled)
                        ShowButtons(cItem);
                    else
                        HideButtons(cItem);                    
                }
            });
        }        
    },false)
}


/**
 * Get only specified group matches
 * 
 * @param {String} string - Content
 * @param {RegExp} regex - Regex
 * @param {Number} index - Group Index
 * @returns {Array} - Array with regex search result.
 */
function getMatches(string, regex, index) {
  index || (index = 1); // default to the first capturing group
  var matches = [];
  var match;
  while (match = regex.exec(string)) {
    matches.push(match[index]);
  }
  return matches;
}

/**
 * Show Edit tab of the specified instance.
 * 
 * @param {String} id - Instance ID
 */
function ShowEditItem(id)
{
    //Set info
    $("#m_iname").html(id.toLowerCase());
    $("#m_url").val(getIURL(id));
    $("#m_folder").val(getIPath(id));

    //Scan for issues
    var bError = ScanForIssues(id);
    if(bError)
    {
        $("#txt_btn_msave").html("Fix & Save");
    }
    else{
        $("#txt_btn_msave").html("Save");
    }

    //Enable tab
    $('#tab_modify').removeClass('disabled');
    $('ul.tabs').tabs('select_tab', 'test2');
    Materialize.updateTextFields();
}

/**
 * Display what issues were found.
 * 
 * @param {String} id - Instance ID
 * @returns {Boolean} - Issue found
 */
function ScanForIssues(id)
{
    let Result = getListIssues(id);

    $("#st_worker").    html( getIcon(Result[0]) );
    $("#st_properties").html( getIcon(Result[1]) );
    $("#st_vhost").     html( getIcon(Result[2]) );
    $("#st_hostname").  html( getIcon(Result[3]) );
    $("#st_jvmport").   html( getIcon(Result[4]) );
    
    //Return true if it had any error.
    return Result.includes(false);
}

/**
 * Gets the properties filname of the instance.
 * 
 * @param {any} id - ID of the instance
 * @returns {String} - Filename
 */
function getPropertiesFileName(id)
{
    var pfileName = id.toLowerCase() + ".properties";
    
    if(FileExist(CFProperties + pfileName,true))
        return pfileName;
    
    if(FileExist(CFProperties + config.get('propprefix') + pfileName,true))
        return config.get('propprefix') + pfileName;
    
    return "NULL";
}

/**
 * Get status of all issues.
 * 
 * @param {String} id - Instance ID
 * @returns {Array} - Array
 */
function getListIssues(id)
{
    let LArray = 
    [
        isOnWorkerList(id),                                         //Worker Status
        getPropertiesFileName(id) != "NULL",                        //Properties Status
        getVHost(id) != "NULL",                                     //VirtualHost Status
        isOnHostName(getIURL(id)),                                  //Hostname Status
        isJVMPortValid(id)                                          //Java Port Status
    ];
    return LArray;

}

/**
 * Execute a fix for all issues.
 * 
 * @param {String} id - Instance ID
 * @param {URL} url - WWW URL of instance
 * @param {String} FolderPath - Folder Path of instance
 */
function FixIssues(id,url,FolderPath)
{
    var LArray = getListIssues(id);
    id = id.toLowerCase();

    //Fix Worker file
    if(!LArray[0])
    {
        var config = getWorkerConfig();
        var wIndex = 'worker.' + id;
        config['worker.list'] = config['worker.list'] + "," + id;
        config[wIndex + ".type"] = "ajp13";
        config[wIndex + ".host"] = "localhost";
        config[wIndex + ".port"] = getRemotePort(id);
        config[wIndex + ".max_reuse_connections"] = "250";
        SaveWorkerConfig(config);
    }

    //Fix Properties file
    if(!LArray[1])
    {
        var NewProperties = fs.readFileSync(__dirname + "/../misc/prototype.properties",'utf8');
        NewProperties = NewProperties.replace(/{INSTANCE}/ig,id);
        fs.writeFile(CFProperties + id.toLowerCase() + ".properties",NewProperties);
    }

    //Fix VirtualHost
    if(!LArray[2])
    {
        AddVHost(id,url,FolderPath);
    }

    //Fix Hostname
    if(!LArray[3])
    {
        hostile.set('127.0.0.1',url);
    }

    //Fix JavaPort
    if(!LArray[4])
    {
        setJavaPort(id,getUniqueJVMPort());
    }
}

/**
 * Adds a new VirtualHost to Apache
 * 
 * @param {String} id - Instance ID
 * @param {String} url - WWW URL
 * @param {String} Folder - Folder Path
 */
function AddVHost(id,url,Folder)
{
    if(config.get('vhpermissions') == true)
        var NewVHost = fs.readFileSync(__dirname + "/../misc/prototype.vhost",'utf8');
    else
        var NewVHost = fs.readFileSync(__dirname + "/../misc/prototype.vhost2",'utf8');

    NewVHost = NewVHost.replace(/{CFPATH}/ig,CFPath);
    NewVHost = NewVHost.replace(/{PATH}/ig,Folder);
    NewVHost = NewVHost.replace(/{URL}/ig,url);
    NewVHost = NewVHost.replace(/{CFID}/ig,id);
    fs.appendFileSync(vhostpath, "\n" + NewVHost);
}

/**
 * Remove the instance VirtualHost from Apache
 * 
 * @param {String} id - Instance ID
 */
function RemoveVHost(id)
{
    // Get all current virtual hosts.
    var VHList = getVHostList();
    var vhostfile = fs.readFileSync(vhostpath,'utf-8');
    
    //Look for instance and delete it.
    var ItemVhost = VHList.find(function(item,index)
    {
        item = item.toLowerCase();
        //let propfilename = getPropertiesFileName(id);
        let PFileName = id.toLowerCase() + ".properties";
        let PPFileName = config.get('propprefix') + PFileName;
        if(item.includes(PFileName) || item.includes(PPFileName))
            return item;
    });
    //Update file.
    fs.writeFileSync(vhostpath,vhostfile.replace(ItemVhost,''),{});
}

/**
 * Updates an existant VirtualHost and changes the URL and FolderPath
 * 
 * @param {String} id - Instance ID
 * @param {String} url  - WWW URL
 * @param {String} Folder - Folder Path
 */
function UpdateVHost(id,url,Folder)
{
    RemoveVHost(id);
    AddVHost(id,url,Folder);
}

/**
 * Get a Material Design Icon for issue status.
 * 
 * @param {Boolean} b 
 * @returns 
 */
function getIcon(b)
{
    var iSuccess = `<i class="material-icons green-text">check_circle</i>`;
    var iError = `<i class="material-icons red-text">error</i>`;

    return (b) ? iSuccess : iError;
}


/**
 * Restarts Apache on current computer
 * 
 */
function RestartApache()
{
    execute(`apachectl restart`,function(output,bfailed){});
}

/**
 * Encrypt a string with SHA1
 * 
 * @param {any} data - Data to encrypt
 * @returns {String} - Encrypted string
 */
function sha1( data ) 
{
     var generator = crypto.createHash('sha1');
     generator.update( data );
     return generator.digest('hex');
}

/**
 * Checks if a folder exists.
 * 
 * @param {String} FolderPath - Folder Path
 * @returns {Boolean}
 */
function FolderExist(FolderPath)
{
    try 
    {
        fs.accessSync(FolderPath);
        return true;
    } catch (error) 
    {
        return false;
    }    
}

/**
 * Start/Stop instance, and reflect on input.
 * 
 * @param {HTMLElement} item - Row item
 */
function StatusChange(item)
{ 
    //Get data
    var cfid = (typeof item === 'object') ? $(item).attr("data-id") : item;
    var action  = (item.checked) ? "start" : "stop";

    //Disable first
    $("#status_"+cfid).prop("disabled",true);    

    //Show loading
    $("#ldr_"+cfid).show();

    //Exec shell
    execute(`bash ${CFPath}/${cfid}/bin/coldfusion ${action}`,
    function(output,bfailed)
    {        
        //Start instance
        if(action == "start")
        {
            //Check for errors.
            if(!output.includes("ColdFusion 11 server has been started") || bfailed)
            {
                Materialize.toast('Error while starting: '+cfid, 6000,"red");
                console.error("336 :: instance "+ cfid + " : " +output);                
                ShowNotification('Error: '+cfid,'ColdFusion failed to start the instance. Check logs.','failed');
                ShowDialog('Error while starting: '+cfid,'Log:\n'+output);
            }
            else
            {
                ShowButtons(cfid);
                ShowNotification("Started: "+cfid,'ColdFusion instance successfully started.','success');
            }
        }
        else
        //Stop instance
        if(action == "stop")
        {
            //Check for errors.
            if(!output.includes("ColdFusion 11 server has been stopped") || bfailed)
            {
                Materialize.toast('Error while stopping: '+cfid, 6000,"red");
                console.error("337 :: instance "+ cfid + " : " +output);             
                ShowNotification('Error: '+cfid,'ColdFusion failed to start the instance. Check logs.','failed');   
                ShowDialog('Error while stopping: '+cfid,'Log:\n'+output);
            }
            else
            {
                HideButtons(cfid);
                ShowNotification('Stopped: '+cfid,'ColdFusion instance successfully stopped.','success');
            }
        }
        
        //Scan for changes
        RefreshStatus(true);

        //Hide loading
        $("#ldr_"+cfid).hide();        
        $("#status_"+cfid).prop("disabled",false);
    },true);
}

/**
 * Display a native OS notification.
 * 
 * @param {any} stitle - Tile of the notification
 * @param {any} sbody - Body of the notification
 * @returns {Object} - NotificationObject
 */
function ShowNotification(stitle,sbody,sicon)
{   
    //Set Icon
    let icon = '';
    switch(sicon)
    {
        case 'success':
            icon = './../resources/imgs/success.png';
            break;
        case 'failed':
            icon = './../resources/imgs/failed.png';
            break;        
    }
    
    //Create notification
    let myNotification = new Notification(
    stitle, 
    {
        body: sbody,
        icon: icon,
        silent: true
    })
    
    return myNotification;
}

/**
 * Display a message box
 * 
 * @param {any} message - Tile of the dialog
 * @param {any} detail - Body of the dialog
 * @param {any} type - Type of dialog
 * @returns {void}
 */
function ShowDialog(message,detail,type)
{
    type = type || 'error';
    detail = detail || '';
    message = message || '';

    dialog.showMessageBox(
    {
        type: type,
        message: message,
        detail: detail
    },
    function(){});     
}


// Events

/**
 * Open Folder Dialog on Modify Tab
 *
 * @event btn_folder#click
 * @type {object}
 */
$("#btn_folder").click(function()
{
    //Show Dialog
    newPath = dialog.showOpenDialog({ defaultPath: $("#m_folder").val(), properties: ['openDirectory','createDirectory']});
    if(typeof newPath != "undefined")
    {
        //Display new path;
        $("#m_folder").val(newPath);
        Materialize.updateTextFields();
    }
});

$("#btn_cfolder").click(function()
{
    //Show Dialog
    newPath = dialog.showOpenDialog({ defaultPath: $("#c_folder").val(), properties: ['openDirectory','createDirectory']});
    if(typeof newPath != "undefined")
    {
        //Display new path;
        $("#c_folder").val(newPath);
        Materialize.updateTextFields();
    }
});

$("#btn_msave").click(function()
{
    var id  = $("#m_iname").html().trim();
    var url = $("#m_url").val().trim();
    var Folder = $("#m_folder").val().trim()
    
    //Preliminary check
    if( url == "" || Folder == "")
    {
        Materialize.toast('All fields are required.', 2000,"red");
        return;
    }

    // Check if url is already being used.
    if( (isOnHostName(url) && getIURL(id) == "NULL") 
        || ( getIURL(id) != "NULL" && getIURL(id) != url && isOnHostName(url) ) )
    {
        Materialize.toast('URL is already being used, try another.', 2000,"red");
        return;
    }

    //Check if folder exists.
    if( !FolderExist(Folder) )
    {
        Materialize.toast('Please enter a valid folder.', 4000,"red");
        return;
    }
    
    //Check if it has issues, if so Fix them.
    if($("#txt_btn_msave").html().includes("Fix"))
        FixIssues(id,url,Folder);

    //Update url and Folder, if it already exist.
    if(getVHost(id) != "NULL") 
    {        
        hostile.remove('127.0.0.1',getIURL(id));
        UpdateVHost(id,url,Folder);
        hostile.set('127.0.0.1',url);
    }
    
    //Restart Apache
    RestartApache();

    //Refresh home url on main view.
    $('#btn_home_'+id).attr('href','http://'+url);
    if($('#status_'+id).prop('checked'))
        $('#btn_home_'+id).removeClass("disabled");
    else
        $('#btn_home_'+id).addClass("disabled");

    //Disable tab and go to Main view.
    $('#tab_modify').addClass('disabled');
    $('ul.tabs').tabs('select_tab', 'test1');    
});

function DeleteReferences(id)
{
    var LArray = getListIssues(id);
    var url = getIURL(id);

    // Clear reference from Workers.Properties
    if(LArray[0])
    {
        //Get workers.properties file.
        var config = getWorkerConfig();
        var wIndex = 'worker.' + id;
        
        //Get Worker.List var from file.
        var WorkerList = config['worker.list'].split(',');
        
        //Look for instance.
        var i = WorkerList.indexOf(id);

        //If found delete it.
        if( i != -1 ) WorkerList.splice(i,1);

        //Update Var
        config['worker.list'] = WorkerList.toString();

        //Delete other references.
        delete config[wIndex + ".type"];
        delete config[wIndex + ".host"];
        delete config[wIndex + ".port"];
        delete config[wIndex + ".max_reuse_connections"];

        //Finally save file.
        SaveWorkerConfig(config);
    }

    // Delete properties file for instance.
    if(LArray[1])
    {
        var PFilename = getPropertiesFileName(id);
        if(PFilename != "NULL")
        {            
            fs.unlinkSync(CFProperties + PFilename);
        }
    }

    // Delete reference of instance in Apache VirtualHost
    if(LArray[2])
    {
        RemoveVHost(id);
    }

    // Remove instance url from host file.
    if(LArray[3])
    {
        hostile.remove("127.0.0.1",url)
    }

    //LArray[4] Skip
}

$("#btn_rdelete").click(function()
{
    var id = $("#m_iname").html();
    DeleteReferences(id);
    ShowEditItem(id);
});

$("#btn_OpenDeleteDialog").click(function()
{
    var id = $("#m_iname").html();
    if($("#status_"+id).prop('checked'))
    {
        Materialize.toast('You first need to turn off the instance.',4000,'red')
        return;
    }    
    
    $('#modal1').modal('open');
});

$("#btn_fdelete").click(function()
{
    var id = $("#m_iname").html();

    //Clear any info from before.
    $('#mdl_cflogin').find("form").trigger("reset");
    //Bind action to CFLogin modal.
    $("#btn_clogin").unbind('click').click(function()
    {
        ExecuteCFAction('delete',id);
    });
    //Opens CFLogin Modal
    $('#mdl_cflogin').modal('open');    
});

// href fix for open in browser.
$(document).on('click', 'a[href^="http"]', function(event) {
    event.preventDefault();
    //shell.openExternal(this.href);
    //Open a webpage without root...
   execSync(`sudo -u ${LoggedUser} open ${this.href}`);
});

function htmlDecode(value) {
  return $("<textarea/>").html(value).text();
}

function CFAdminAction(action, NewID, cfid, cfpwd, callback, bOnce)
{
    //Login POST data.
    var cfLoginData = 
    {
        cfadminUserId: cfid,
        cfadminPassword: sha1(cfpwd).toUpperCase()
    };

    // GET cfusion administrator URL
    var cfport = getHTTPPort('cfusion');
    var portstr = (cfport != "") ? ":" + cf_port.innerHTML : "";
    cfurl = "http://localhost" + portstr + "/CFIDE/administrator";
    
    //Set a default to callback.
    if(typeof callback !== 'function') callback = function(){};    

    //First time running? //
    //request.post('http://localhost/CFIDE/administrator/index.cfm?configServer=true').form(cfLoginData);
    //request('http://localhost/CFIDE/administrator/index.cfm?configServer=true');
    
    //Clear Cookies
    request.jar();

    // Login to CF Administrator
    request.post(cfurl + '/enter.cfm',
    {form:cfLoginData, timeout: 180000},
    function(err,httpResponse,body)
    {
        if(err || body.includes('503 Service Unavailable'))
        {
            err = (err) ? err : "503 Service Unavailable";
            console.error("338 :: ERROR :: " + err);
            Materialize.toast('Error while connecting to CF Administrator.<br>Make sure cfusion instance is running.', 7000,"red");
            callback(true);
            return;
        }
        
        if(body.includes("Invalid Password. Please try again"))
        {
            Materialize.toast('Invalid password', 6000,"red");
            callback(true);
            return;
        }

        //Travel to "Instance manager"
        request.get(cfurl + '/entman/index.cfm',
        {timeout: 180000},
        function (error, response, body) 
        {
            if( error && error.code === 'ETIMEDOUT' )
            {
                console.error("339 :: ERROR : Timeout");
                callback(true);
                return;
            }

            //WAT, sometimes login fails?
            if( typeof bOnce === 'undefined' &&  
                body.includes('ColdFusion Administrator Login') )
            {
                //RESTART ONCE else continue and get error.
                CFAdminAction(action, NewID, cfid, cfpwd, callback, true);
                return;
            }

            //HERE
            if( action == "create" )
            {
                //Get link and TOKEN
                var re = new RegExp(/.*action="(addserver.cfm\?servertype=addlocal[^"]*).*/,'ig');
                var AddServerURL = getMatches(body,re,1);
                if(AddServerURL.length <= 0)
                {
                    console.error("340 :: ERROR :: Unhandled error.");
                    console.log("bOnce->"+bOnce);
                    console.log(body);
                    Materialize.toast('340: Error while creating instance.', 6000,"red");
                    callback(true);
                    return;
                }

                //Travel to "Add new instance" page
                request.get(cfurl + '/entman/' + AddServerURL[0],
                {timeout: 180000},
                function (error, response, body)
                {
                    //Get link and TOKEN
                    var re = new RegExp(/.*action="(processaddserver.cfm?[^"]*).*/,'ig');
                    var ProcessServerURL = getMatches(body,re,1);
                    if(ProcessServerURL.length <= 0)
                    {
                        console.error("341 :: ERROR :: Failed to create server.");
                        Materialize.toast('341: Error while creating instance.', 6000,"red");
                        callback(true);
                        return;
                    }
                    
                    instanceData = 
                    {
                        serverName: NewID,
                        directory: CFPath + "/" + NewID
                    }
                    
                    //Submit form.
                    request.post(cfurl + "/entman/" + ProcessServerURL[0],
                    {form:instanceData},
                    function(err,httpResponse,body)
                    {
                        //Handle error with connection.
                        if(err) 
                        {
                            Materialize.toast('Error while submitting instance', 6000,"red");
                            console.error('342 :: ERROR :: ' + err);
                            callback(true);
                            return;
                        }                        
                        
                        //Check if there was an error.
                        if(body.includes("There was a problem"))
                        {
                            //Do not load anything. We just want TEXT.
                            //DAMN BIG REGEX
                            body = body.replace(/(<(\b(img|style|script|head|link)\b)(([^>]*\/>)|([^\7]*(<\/\2[^>]*>)))|(<\bimg\b)[^>]*>|(\b(background|style)\b=\s*"[^"]*"))/g,"");                        
                            
                            //Handle known errors.
                            if(body.includes("duplicate server name"))
                            {                        
                                Materialize.toast('Instance \''+ NewID + '\' already exists', 6000,"red");
                                callback(true);
                                return; 
                            }
                            
                            //Get error details
                            var ErrorDetail = $(body).find('.errorText').text().trim();
                            ErrorDetail = ErrorDetail.replace(/  /g, '')
                            
                            //Show it.
                            alert(ErrorDetail);
                            //dialog.showMessageBox({type:'error',title:'Error',detail: ErrorDetail}, function() {});
                            callback(true);
                            return;
                        }
                        
                        //
                        callback(false);
                    });
                });
            }
            else
            if( action == "delete" )
            {
                //Get link and 
                var re = new RegExp("href=\"(index\\.cfm(\\?|&#x3f;)action(&#x3d;|=)delete(&amp;|&)server(&#x3d;|=)"+NewID+"&[^\"]*)",'ig');
                var DeleteURL = getMatches(body,re,0);
                if(DeleteURL.length <= 0)
                {
                    console.error("343 :: ERROR :: Unhandled error when deleting.");
                    //console.log(body);
                    Materialize.toast('Error while deleting instance.', 6000,"red");
                    callback(true);
                    return;
                }

                DeleteURL[0] = htmlDecode(DeleteURL);

                request.get(cfurl + '/entman/' + DeleteURL[0],
                {timeout: 180000},
                function (error, response, body)
                {
                    if(instanceExist(NewID))
                    {
                       callback(true);
                       console.error('344 :: ERROR :: Couldnt delete instance.');
                       Materialize.toast('Error while deleting instance.', 6000,"red");
                       return;
                    }

                    callback(false);
                });
            }
            else
            {
                callback(true);
                console.error('345 :: ERROR :: Unknown action on CFAdminAction');
                Materialize.toast('Unknown Error.', 6000,"red");
            }
        });
    });
}

function instanceExist(id)
{
    var IList = getCFIDList();
    IList = IList.map(function(x){ return x.toLowerCase() });

    return IList.includes(id.toLowerCase());
}


$("#btn_csave").click(function()
{
    if( !$('#frm_create')[0].checkValidity() )
    {
        Materialize.toast('All fields are required', 4000,"red");
        $('#frm_create').find(':submit').click();
        return;
    }

    var id  = $("#c_id").val().trim();
    var url = $("#c_url").val().trim();
    var Folder = $("#c_folder").val().trim();
    
    
    if( instanceExist(id) )
    {
        Materialize.toast('Instance ID already exists.', 2000,"red");
        return;
    }

    // Check if url is already being used.
    if( (isOnHostName(url) && getIURL(id) == "NULL") 
        || ( getIURL(id) != "NULL" && getIURL(id) != url && isOnHostName(url) ) )
    {
        Materialize.toast('URL is already being used, try another.', 2000,"red");
        return;
    }

    //Check if folder exists.
    if( !FolderExist(Folder) )
    {
        Materialize.toast('Please enter a valid folder.', 4000,"red");
        return;
    }

    //Clear any info from before.
    $('#mdl_cflogin').find("form").trigger("reset");
    //Bind action to CFLogin modal.
    $("#btn_clogin").unbind('click').click(function()
    {
        ExecuteCFAction('create',id,url,Folder)        
    });
    //Opens CFLogin Modal
    $('#mdl_cflogin').modal('open');
});

function ExecuteCFAction(action,id,url,Folder)
{
    var username = $("#cflogin_user").val().trim();
    var password = $("#cflogin_password").val().trim();    

    if(username == "" || password == "")
    {
        Materialize.toast('All fields are required', 4000,"red");
        return;
    }

    $.LoadingOverlay("show");

    CFAdminAction(action,id,username,password,
    function(bError)
    {
        //This only executes if everything went fine.
        if(!bError)
        {
            if( action == 'create' )
            {
                FixIssues(id,url,Folder);
                RestartApache();
                
                $('#mdl_cflogin').modal('close');
                $('#mdl_cinstance').modal('close');
                $('#mdl_cinstance').find("form").trigger("reset");

                //Add row to main table.
                let tr = createIRow(id);
                //Hide first
                $(tr).hide();
                //Add it to table.
                AddIRow(tr);
                //Make a fade in effect.
                $(tr).fadeIn();

                //Everything went fine. Notify user.
                Materialize.toast('Instance \''+ id + '\' was created successfully', 6000,"green");                
            }
            else
            if( action == 'delete' )
            {
                //Move to another tab.
                $('#tab_modify').addClass('disabled');
                $('ul.tabs').tabs('select_tab', 'test1');
                
                //
                DeleteReferences(id);
                $('#mdl_cflogin').modal('close');

                //Notify user
                Materialize.toast('Instance \''+id+'\' was deleted successfully', 6000,"green");

                //Fade out, and remove it after effect end.
                $('#row_'+id).fadeOut(function()
                {
                    $(this).remove();
                });
            }
        }

        $.LoadingOverlay("hide");
    });    
}

$("#sn_exit").click(function()
{
    var window = remote.getCurrentWindow();
    window.close();
});

$("#sn_devtools").click(function()
{
    var window = remote.getCurrentWindow();
    window.webContents.openDevTools()    
});

$("#sn_settings").click(function()
{   
    $('#cnf_navcolor').val(config.get('navbarcolor'));
    $('#cnf_cflocation').val(config.get('cflocation'));
    $('#cnf_propprefix').val(config.get('propprefix'));
    $('#cnf_vhpermission').prop("checked",config.get('vhpermissions'));
    Materialize.updateTextFields();
    $("#mdl_config").modal('open');
});

$("#btn_configsave").click(function()
{
    config.set('navbarcolor',$('#cnf_navcolor').val());
    config.set('cflocation',$('#cnf_cflocation').val());
    config.set('propprefix',$('#cnf_propprefix').val());
    config.set('vhpermissions',$('#cnf_vhpermission').prop("checked"));
    location.reload();
});

$("#sn_about").click(function()
{
    var window = remote.getCurrentWindow();
    alert('Created by Mario Nuñez\n'+
          'github.com/mar-hn\ntwitter.com/marz_hn \n'+
          'Version ' + app.getVersion()) 
});

$("#btn_refresh").click(function()
{
    //RefreshStatus(true);
    location.reload();
    //ShowNotification('test','what','failed');
});

$("#btn_create").click(function()
{
    if(!$("#status_cfusion").prop('checked'))
    {
        Materialize.toast('You need to turn on the cfusion instance first.', 3000,"red");
        return;
    }
    
    $("#mdl_cinstance").modal('open');
});

$("form",".modal").each(function()
{
    let mdl = $(this).parents('.modal');
    $(this).find('input').keypress(function(e) 
    {
        // Enter pressed?
        if(e.which == 10 || e.which == 13)
        { 
            $(mdl).find(".btnsubmit").click();
        }
    });
});