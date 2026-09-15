param(
    [Parameter(Mandatory=$true)][string]$InputPath,
    [Parameter(Mandatory=$true)][string]$OutputPath,
    [Parameter(Mandatory=$true)][ValidateSet('xlsx','xls','docx','doc','html','pdf')][string]$Format
)
$ErrorActionPreference = 'Stop'
$inputFile = [System.IO.Path]::GetFullPath($InputPath)
$outputFile = [System.IO.Path]::GetFullPath($OutputPath)
if ($inputFile -eq $outputFile) { throw 'Conversion needs a separate output file.' }
$extension = [System.IO.Path]::GetExtension($inputFile).ToLowerInvariant()
$application = $null
$document = $null
try {
    if ($extension -in @('.xlsx','.xls','.htm','.html') -and $Format -in @('xlsx','xls','html','pdf')) {
        $application = New-Object -ComObject Excel.Application
        $application.Visible = $false
        $application.DisplayAlerts = $false
        $application.AutomationSecurity = 3
        $application.AskToUpdateLinks = $false
        $document = $application.Workbooks.Open($inputFile, 0, $true)
        if ($Format -eq 'pdf') {
            $document.ExportAsFixedFormat(0, $outputFile)
        } else {
            $code = @{xlsx=51; xls=56; html=44}[$Format]
            $document.SaveAs($outputFile, $code)
        }
    } else {
        $application = New-Object -ComObject Word.Application
        $application.Visible = $false
        $application.DisplayAlerts = 0
        $application.AutomationSecurity = 3
        $document = $application.Documents.Open($inputFile, $false, $true, $false)
        if ($Format -eq 'pdf') {
            $document.ExportAsFixedFormat($outputFile, 17)
        } else {
            $code = @{docx=12; doc=0; html=10}[$Format]
            if ($null -eq $code) { throw 'Unsupported conversion.' }
            $document.SaveAs2($outputFile, $code)
        }
    }
} finally {
    if ($null -ne $document) {
        $document.Close($false) | Out-Null
        [System.Runtime.InteropServices.Marshal]::FinalReleaseComObject($document) | Out-Null
    }
    if ($null -ne $application) {
        $application.Quit() | Out-Null
        [System.Runtime.InteropServices.Marshal]::FinalReleaseComObject($application) | Out-Null
    }
    [GC]::Collect()
    [GC]::WaitForPendingFinalizers()
}
if (-not [System.IO.File]::Exists($outputFile)) { throw 'Office did not create the converted file.' }
