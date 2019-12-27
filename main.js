const electron = require('electron')
const {app, BrowserWindow, Menu} = electron
const sudo = require('sudo-prompt');
const exec = require('child_process').execSync;
const {autoUpdater} = require("electron-updater");

let win;  

app.on('ready',() =>
{
  var User = exec("sudo -k && whoami",{encoding:"utf8"});
  if(!User.includes("root"))
  {
    sudo.exec('"' + app.getPath('exe') + '" &',
    {name:"Coldfusion Instance Manager"},
    function(error, stdout, stderr) 
    {
      app.quit();
    });
    return;
  }

  win = new BrowserWindow({
    width:800, 
    height: 600,
    minWidth: 506,
    maxWidth: 800
  })  

  win.on('closed', () => {
    win = null
    app.quit();
  })
  
  //Load main view
  win.loadURL(`file://${__dirname}/app/views/index.html`)
  
  //$FIX dunno why but this fixes the Materialize animations when starting app.
  win.loadURL(`file://${__dirname}/app/views/index.html`)

  //$FIX Clipboard not working.
  // Create the Application's main menu
  var template = [{
      label: "Application",
      submenu: [
          { label: "Check For Update", click: function(item) {checkForUpdates(item)}},
          { label: "Console", accelerator: "Command+T", click: function() { win.webContents.openDevTools(); }},
          { type: "separator" },
          { label: "Quit", accelerator: "Command+Q", click: function() { app.quit(); }}
      ]}, {
      label: "Edit",
      submenu: [
          { label: "Undo", accelerator: "CmdOrCtrl+Z", selector: "undo:" },
          { label: "Redo", accelerator: "Shift+CmdOrCtrl+Z", selector: "redo:" },
          { type: "separator" },
          { label: "Cut", accelerator: "CmdOrCtrl+X", selector: "cut:" },
          { label: "Copy", accelerator: "CmdOrCtrl+C", selector: "copy:" },
          { label: "Paste", accelerator: "CmdOrCtrl+V", selector: "paste:" },
          { label: "Select All", accelerator: "CmdOrCtrl+A", selector: "selectAll:" }
      ]}
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
});

// ---------------------------------------------------------
// Updater module
// ---------------------------------------------------------
const { dialog } = require('electron')

let updater
let bDownloading = false
autoUpdater.autoDownload = false


autoUpdater.on('error', (event, error) => 
{
  if(!error) error = "Unknown error";
  dialog.showErrorBox('ColdFusion Instance Manager general protection fault', event + ' :: ' + error);  
})

autoUpdater.on('update-available', () => {
  dialog.showMessageBox({
    type: 'info',
    title: 'Found Updates',
    message: 'Found updates, do you want update now?',
    buttons: ['Sure', 'No']
  }, (buttonIndex) => 
  {
    if (buttonIndex === 0) 
    {
      //bDownloading = true;
      //autoUpdater.downloadUpdate()
      //Open webpage with download
      var LoggedUser = exec(`sudo stat -f "%Su" /dev/console`,{encoding:"utf8"}).trim();
      exec(`sudo -u ${LoggedUser} open https://github.com/mar-hn/CFInstanceManager/releases/`);
    }

    //Reset menu
    if(updater != null)
    {
      updater.enabled = true
      updater = null
    }    
  })
})
autoUpdater.on('update-not-available', () => {
  dialog.showMessageBox({
    title: 'No Updates', 
    message: 'Current version is up-to-date.'
  })
  if(updater != null)
  {
    updater.enabled = true
    updater = null
  }
})
autoUpdater.on('update-downloaded', () => {
  dialog.showMessageBox({
    title: 'Install Updates',
    message: 'Updates downloaded, application will be quit for update...'
  }, () => 
  {
    autoUpdater.quitAndInstall()
  })
})

autoUpdater.on('download-progress', (ev, progressObj) => 
{
  
})


// export this to MenuItem click callback
function checkForUpdates (menuItem) {
  updater = menuItem
  updater.enabled = false
  autoUpdater.checkForUpdates()
}
module.exports.checkForUpdates = checkForUpdates