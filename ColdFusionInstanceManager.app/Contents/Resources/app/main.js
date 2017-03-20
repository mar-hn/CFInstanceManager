const electron = require('electron')
const {app, BrowserWindow, Menu} = electron
const sudo = require('sudo-prompt');
const exec = require('child_process').execSync;

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

  let win = new BrowserWindow({
    width:800, 
    height: 600,
    minWidth: 506,
    maxWidth: 800
  })  

  win.on('closed', () => {
    win = null
    app.quit();
  })
  
  win.loadURL(`file://${__dirname}/app/views/index.html`)
  //$FIX dunno why but this fixes the Materialize animations when starting app.
  win.loadURL(`file://${__dirname}/app/views/index.html`)
  //win.webContents.openDevTools();

  //$FIX Clipboard not working.
  // Create the Application's main menu
  var template = [{
      label: "Application",
      submenu: [
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