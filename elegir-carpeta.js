// ============================================================
//  SELECTOR DE CARPETA NATIVO DE WINDOWS
// ============================================================
//
//  Qué hace:
//   Abre el explorador de Windows (el diálogo real "Seleccionar
//   carpeta") usando PowerShell, que viene incluido en cualquier
//   Windows - no depende de ninguna librería externa de npm.
//
//   Se fuerza a que la ventana aparezca AL FRENTE (TopMost), porque
//   cuando Node lanza PowerShell como proceso de fondo, el diálogo
//   puede abrirse detrás de las demás ventanas sin que se note.
//
//   Devuelve la ruta elegida, o null si el contador cancela.
// ============================================================

const { exec } = require('child_process');

function elegirCarpeta() {
  return new Promise((resolve, reject) => {
    const comandoPowerShell = `
      Add-Type -AssemblyName System.Windows.Forms
      Add-Type -AssemblyName System.Drawing

      $forma = New-Object System.Windows.Forms.Form
      $forma.TopMost = $true
      $forma.WindowState = 'Minimized'
      $forma.ShowInTaskbar = $false

      $dialogo = New-Object System.Windows.Forms.FolderBrowserDialog
      $dialogo.Description = "Selecciona la carpeta donde se guardaran los archivos"
      $dialogo.ShowNewFolderButton = $true

      $resultado = $dialogo.ShowDialog($forma)

      if ($resultado -eq [System.Windows.Forms.DialogResult]::OK) {
        Write-Output $dialogo.SelectedPath
      }

      $forma.Dispose()
    `;

    // Codificamos el comando para evitar problemas con comillas y saltos de línea
    const comandoCodificado = Buffer.from(comandoPowerShell, 'utf16le').toString('base64');

    exec(
      `powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -EncodedCommand ${comandoCodificado}`,
      { windowsHide: true },
      (error, stdout, stderr) => {
        if (error) {
          console.error('Error al abrir el selector de carpeta:', error.message);
          console.error('stderr:', stderr);
          return reject(error);
        }
        const ruta = stdout.trim();
        resolve(ruta || null); // null si el contador le dio "Cancelar"
      }
    );
  });
}

module.exports = { elegirCarpeta };