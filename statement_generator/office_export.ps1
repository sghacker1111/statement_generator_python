param(
    [Parameter(Mandatory = $true)]
    [ValidateSet("statement", "certificate")]
    [string]$Mode,

    [Parameter(Mandatory = $true)]
    [string]$TemplatePath,

    [Parameter(Mandatory = $true)]
    [string]$OutputPath,

    [Parameter(Mandatory = $true)]
    [string]$PayloadPath
)

$ErrorActionPreference = "Stop"

function Read-Payload {
    return Get-Content -LiteralPath $PayloadPath -Raw | ConvertFrom-Json
}

function Convert-ToText($Value) {
    if ($null -eq $Value) {
        return ""
    }
    return [System.Convert]::ToString($Value, [System.Globalization.CultureInfo]::InvariantCulture)
}

function Get-MeaningfulPrintArea($Worksheet) {
    $used = $Worksheet.UsedRange
    $startRow = [int]$used.Row
    $startCol = [int]$used.Column
    $endRow = $startRow + [int]$used.Rows.Count - 1
    $endCol = $startCol + [int]$used.Columns.Count - 1
    $lastRow = $startRow
    $lastCol = $startCol
    $found = $false
    for ($row = $startRow; $row -le $endRow; $row++) {
        for ($col = $startCol; $col -le $endCol; $col++) {
            $cell = $Worksheet.Cells.Item($row, $col)
            $text = (Convert-ToText $cell.Text).Trim()
            $formula = (Convert-ToText $cell.Formula).Trim()
            if ([string]::IsNullOrWhiteSpace($text) -and [string]::IsNullOrWhiteSpace($formula)) {
                continue
            }
            $found = $true
            $lastRow = [Math]::Max($lastRow, $row)
            $lastCol = [Math]::Max($lastCol, $col)
        }
    }
    if (-not $found) {
        return $used.Address($false, $false)
    }
    return $Worksheet.Range($Worksheet.Cells.Item($startRow, $startCol), $Worksheet.Cells.Item($lastRow, $lastCol)).Address($false, $false)
}

function Apply-WorksheetPrintSetup($Worksheet) {
    try {
        $Worksheet.PageSetup.PaperSize = 9
        $Worksheet.PageSetup.Zoom = $false
        $Worksheet.PageSetup.FitToPagesWide = 1
        $Worksheet.PageSetup.FitToPagesTall = $false
        $Worksheet.PageSetup.LeftMargin = $Worksheet.Application.InchesToPoints(0.25)
        $Worksheet.PageSetup.RightMargin = $Worksheet.Application.InchesToPoints(0.25)
        $Worksheet.PageSetup.TopMargin = $Worksheet.Application.InchesToPoints(0.35)
        $Worksheet.PageSetup.BottomMargin = $Worksheet.Application.InchesToPoints(0.35)
        $Worksheet.PageSetup.HeaderMargin = $Worksheet.Application.InchesToPoints(0.2)
        $Worksheet.PageSetup.FooterMargin = $Worksheet.Application.InchesToPoints(0.2)
        $Worksheet.PageSetup.PrintArea = Get-MeaningfulPrintArea $Worksheet
    } catch {
    }
}

function Apply-DocumentPrintSetup($Document) {
    try {
        foreach ($section in $Document.Sections) {
            $section.PageSetup.PaperSize = 7
            $section.PageSetup.PageWidth = 595.3
            $section.PageSetup.PageHeight = 841.9
            $section.PageSetup.LeftMargin = 36
            $section.PageSetup.RightMargin = 36
            $section.PageSetup.TopMargin = 36
            $section.PageSetup.BottomMargin = 36
        }
    } catch {
    }
}

function Get-CellText($Cell) {
    if ($null -eq $Cell) {
        return ""
    }
    return Convert-ToText $Cell.Text
}

function Get-WritableCell($Cell) {
    if ($null -eq $Cell) {
        return $Cell
    }
    try {
        if ($Cell.MergeCells) {
            return $Cell.MergeArea.Cells.Item(1, 1)
        }
    } catch {
        return $Cell
    }
    return $Cell
}

function Clear-CellValue($Cell) {
    if ($null -eq $Cell) {
        return
    }
    try {
        if ($Cell.MergeCells) {
            $Cell.MergeArea.ClearContents() | Out-Null
            return
        }
    } catch {
        # fall back to the writable cell below
    }
    $target = Get-WritableCell $Cell
    if ($null -ne $target) {
        $target.ClearContents() | Out-Null
    }
}

function Set-BlankOrValue($Cell, $Value) {
    $Cell = Get-WritableCell $Cell
    $text = Convert-ToText $Value
    if ([string]::IsNullOrWhiteSpace($text)) {
        Clear-CellValue $Cell
        return
    }
    $Cell.Value = $text
}

function Set-TextValue($Cell, $Value) {
    $Cell = Get-WritableCell $Cell
    $text = Convert-ToText $Value
    if ([string]::IsNullOrWhiteSpace($text)) {
        Clear-CellValue $Cell
        return
    }
    $Cell.NumberFormat = "@"
    $Cell.Value = $text
}

function Set-IntegerValue($Cell, $Value) {
    $Cell = Get-WritableCell $Cell
    $text = Convert-ToText $Value
    if ([string]::IsNullOrWhiteSpace($text)) {
        Clear-CellValue $Cell
        return
    }
    $number = [long]0
    if (-not [long]::TryParse($text, [ref]$number)) {
        Set-TextValue $Cell $text
        return
    }
    $Cell.NumberFormat = "0"
    $Cell.Value2 = [double]$number
}

function Set-NumberValue($Cell, $Value, $NumberFormat) {
    $Cell = Get-WritableCell $Cell
    $number = Convert-ToNullableDouble $Value
    if ($null -eq $number) {
        Clear-CellValue $Cell
        return
    }
    $existingFormat = Convert-ToText $Cell.NumberFormat
    if (-not [string]::IsNullOrWhiteSpace((Convert-ToText $NumberFormat)) -and ($existingFormat -eq "General" -or $existingFormat -eq "@")) {
        $Cell.NumberFormat = $NumberFormat
    }
    $Cell.Value2 = [double]$number
}

function Set-DateValue($Cell, $IsoDate) {
    $Cell = Get-WritableCell $Cell
    $isoText = Convert-ToText $IsoDate
    if ([string]::IsNullOrWhiteSpace($isoText)) {
        Clear-CellValue $Cell
        return
    }
    $cultureInvariant = [System.Globalization.CultureInfo]::InvariantCulture
    $styles = [System.Globalization.DateTimeStyles]::None
    $parsed = [datetime]::ParseExact($isoText, "yyyy-MM-dd", $cultureInvariant, $styles)
    $Cell.NumberFormat = "yyyy-mm-dd"
    $Cell.Value2 = $parsed.ToOADate()
}

function Convert-ToNullableDouble($Value) {
    if ($null -eq $Value) {
        return $null
    }

    if ($Value -is [double] -or $Value -is [float] -or $Value -is [decimal] -or $Value -is [int] -or $Value -is [long]) {
        return [double]$Value
    }

    $text = Convert-ToText $Value
    if ([string]::IsNullOrWhiteSpace($text)) {
        return $null
    }

    $styles = [System.Globalization.NumberStyles]::Any
    $cultureInvariant = [System.Globalization.CultureInfo]::InvariantCulture
    $cultureCurrent = [System.Globalization.CultureInfo]::CurrentCulture
    $number = 0.0

    if ([double]::TryParse($text, $styles, $cultureInvariant, [ref]$number)) {
        return $number
    }
    if ([double]::TryParse($text, $styles, $cultureCurrent, [ref]$number)) {
        return $number
    }

    $normalized = $text.Replace(",", "")
    if ([double]::TryParse($normalized, $styles, $cultureInvariant, [ref]$number)) {
        return $number
    }
    if ([double]::TryParse($normalized, $styles, $cultureCurrent, [ref]$number)) {
        return $number
    }

    throw "Could not convert value '$text' to a numeric amount."
}

function Format-AmountText($Value) {
    $number = Convert-ToNullableDouble $Value
    if ($null -eq $number) {
        return ""
    }
    return $number.ToString("N2", [System.Globalization.CultureInfo]::InvariantCulture)
}

function Replace-ValueKeepingLabel($Text, $Replacement) {
    $textValue = Convert-ToText $Text
    $replacementValue = Convert-ToText $Replacement
    if ([string]::IsNullOrWhiteSpace($textValue)) {
        return $replacementValue
    }
    if ($textValue -match "^(.*?)(\s*:-\s*|\s*:\s*).*$") {
        $label = $matches[1].TrimEnd()
        $separator = if ($textValue -match ":-") { " :- " } else { ": " }
        return "$label$separator$replacementValue"
    }
    return $replacementValue
}

function Resolve-PayloadToken($Token, $Payload) {
    $key = (Convert-ToText $Token).Trim().ToLowerInvariant().Replace(".", "_").Replace("-", "_")
    switch ($key) {
        "bank_name" { return Convert-ToText $Payload.account.bank_name }
        "branch_name" { return Convert-ToText $Payload.account.branch_name }
        { $_ -in @("reference_no", "ref_no") } { return Convert-ToText $Payload.account.reference_no }
        { $_ -in @("date", "issue_date", "issue_date_slash") } { return Convert-ToText $Payload.statement.issue_date_slash }
        "issue_date_iso" { return Convert-ToText $Payload.statement.issue_date_iso }
        { $_ -in @("name", "customer_name") } { return Convert-ToText $Payload.account.customer_name }
        { $_ -in @("address", "customer_address") } { return Convert-ToText $Payload.account.customer_address }
        { $_ -in @("account_no", "account_number") } { return Convert-ToText $Payload.account.account_number }
        "account_type" { return Convert-ToText $Payload.account.account_type }
        "member_id" { return Convert-ToText $Payload.account.member_id }
        "currency" { return Convert-ToText $Payload.account.currency }
        { $_ -in @("total_balance", "total_balance_npr", "total_balance_npr_text") } { return Convert-ToText $Payload.certificate.total_balance_npr_text }
        { $_ -in @("final_balance", "final_balance_text") } { return Convert-ToText $Payload.summary.final_balance_text }
        { $_ -in @("balance_words", "balance_words_npr") } { return Convert-ToText $Payload.certificate.balance_words_npr }
        { $_ -in @("exchange_rate", "usd_npr", "usd_npr_text") } { return Convert-ToText $Payload.rates.usd_npr_text }
        { $_ -in @("equivalent_usd", "equivalent_usd_text", "usd_balance") } { return Convert-ToText $Payload.certificate.equivalent_usd_text }
        { $_ -in @("balance_words_usd", "usd_balance_words") } { return Convert-ToText $Payload.certificate.balance_words_usd }
        "authorization_details" {
            $value = Convert-ToText $Payload.certificate.authorization_details
            if ([string]::IsNullOrWhiteSpace($value)) { return "Authorized Signature" }
            return $value
        }
        default { return $null }
    }
}

function Expand-PayloadTokens($Text, $Payload) {
    $textValue = Convert-ToText $Text
    return [regex]::Replace($textValue, "\{\{\s*([A-Za-z0-9_.-]+)\s*\}\}", {
        param($Match)
        $replacement = Resolve-PayloadToken $Match.Groups[1].Value $Payload
        if ($null -eq $replacement) {
            return $Match.Value
        }
        return Convert-ToText $replacement
    })
}

function Find-HeaderInfo($Worksheet) {
    $used = $Worksheet.UsedRange
    $startRow = $used.Row
    $endRow = [Math]::Min($startRow + [Math]::Min($used.Rows.Count, 40) - 1, 60)
    $startCol = $used.Column
    $endCol = [Math]::Min($startCol + $used.Columns.Count - 1, 12)

    for ($row = $startRow; $row -le $endRow; $row++) {
        $map = @{}
        for ($col = $startCol; $col -le $endCol; $col++) {
            $text = (Get-CellText $Worksheet.Cells.Item($row, $col)).Trim()
            $low = $text.ToLowerInvariant()
            if ($low -eq "value date") {
                $map["value_date"] = $col
                if (-not $map.ContainsKey("date")) {
                    $map["date"] = $col
                }
            } elseif ($low -eq "transaction date" -or $low -eq "txn date") {
                $map["txn_date"] = $col
                if (-not $map.ContainsKey("date")) {
                    $map["date"] = $col
                }
            } elseif ($low -eq "date") {
                $map["date"] = $col
            } elseif ($low -like "*description*" -or $low -like "*particular*" -or $low -like "*narration*") {
                $map["description"] = $col
            } elseif ($low -like "*cheque*" -or $low -like "*chq*") {
                $map["cheque"] = $col
            } elseif ($low -like "*debit*" -or $low -like "*withdraw*") {
                $map["debit"] = $col
            } elseif ($low -like "*credit*" -or $low -like "*deposit*") {
                $map["credit"] = $col
            } elseif ($low -like "*balance*") {
                $map["balance"] = $col
            }
        }

        if ($map.ContainsKey("date") -and $map.ContainsKey("description") -and $map.ContainsKey("debit") -and $map.ContainsKey("credit") -and $map.ContainsKey("balance")) {
            return @{
                Row = $row
                Map = $map
            }
        }
    }

    return $null
}

function Find-DataRange($Worksheet, $HeaderInfo) {
    $used = $Worksheet.UsedRange
    $lastRow = $used.Row + $used.Rows.Count - 1
    $startRow = $HeaderInfo.Row + 1
    $endRow = $startRow - 1
    $seenData = $false

    for ($row = $startRow; $row -le $lastRow; $row++) {
        $desc = (Get-CellText $Worksheet.Cells.Item($row, $HeaderInfo.Map["description"])).Trim()
        $balance = (Get-CellText $Worksheet.Cells.Item($row, $HeaderInfo.Map["balance"])).Trim()
        $date = (Get-CellText $Worksheet.Cells.Item($row, $HeaderInfo.Map["date"])).Trim()
        $debit = (Get-CellText $Worksheet.Cells.Item($row, $HeaderInfo.Map["debit"])).Trim()
        $credit = (Get-CellText $Worksheet.Cells.Item($row, $HeaderInfo.Map["credit"])).Trim()
        if (Test-SummaryStatementRow $Worksheet $row $HeaderInfo) {
            break
        }
        $isDataRow = -not [string]::IsNullOrWhiteSpace($desc) -or -not [string]::IsNullOrWhiteSpace($balance) -or -not [string]::IsNullOrWhiteSpace($date) -or -not [string]::IsNullOrWhiteSpace($debit) -or -not [string]::IsNullOrWhiteSpace($credit)
        if ($isDataRow) {
            $seenData = $true
            $endRow = $row
            continue
        }
        if (Test-BlankStatementDataRow $Worksheet $row $HeaderInfo) {
            $endRow = $row
            continue
        }
        if ($seenData) {
            break
        }
    }

    return @{
        Start = $startRow
        End = $endRow
        Capacity = ($endRow - $startRow + 1)
        MaxColumn = ($used.Column + $used.Columns.Count - 1)
    }
}

function Get-WorksheetRowText($Worksheet, $Row, $StartCol, $EndCol) {
    $parts = @()
    for ($col = $StartCol; $col -le $EndCol; $col++) {
        $text = (Get-CellText $Worksheet.Cells.Item($Row, $col)).Trim()
        if (-not [string]::IsNullOrWhiteSpace($text)) {
            $parts += $text
        }
    }
    return ($parts -join " ")
}

function Test-SummaryStatementRow($Worksheet, $Row, $HeaderInfo) {
    $map = $HeaderInfo.Map
    $startCol = [Math]::Min([int]$map["date"], [int]$map["description"])
    $endCol = [Math]::Max([int]$map["balance"], [int]$map["credit"])
    if ($map.ContainsKey("cheque")) {
        $endCol = [Math]::Max($endCol, [int]$map["cheque"])
    }
    $rowText = (Get-WorksheetRowText $Worksheet $Row $startCol ([Math]::Min($endCol + 4, $endCol + 8))).ToLowerInvariant()
    if ([string]::IsNullOrWhiteSpace($rowText) -or -not ($rowText -match "\b(total|summary|closing balance|balance in words?|transaction summary|notice|prepared by|checked by|verified by|approved by|authorized|signature|grand total|brought forward)\b")) {
        return $false
    }
    $dateText = (Get-CellText $Worksheet.Cells.Item($Row, $map["date"])).Trim()
    if ($dateText -match "^(\d{4}[-/]\d{1,2}[-/]\d{1,2}|\d{1,2}[-/]\d{1,2}[-/]\d{4})$" -or $Worksheet.Cells.Item($Row, $map['date']).Value2 -is [double]) {
        return $false
    }
    return $true
}

function Test-TransactionTotalRow($Worksheet, $Row, $HeaderInfo) {
    $used = $Worksheet.UsedRange
    $lastCol = [Math]::Min($used.Column + $used.Columns.Count - 1, [int]$HeaderInfo.Map["balance"] + 6)
    $rowText = (Get-WorksheetRowText $Worksheet $Row $used.Column $lastCol).ToLowerInvariant()
    if ([string]::IsNullOrWhiteSpace($rowText) -or -not $rowText.Contains("total")) {
        return $false
    }
    return -not ($rowText -match "total\s+(credit|debit|balance)")
}

function Test-BlankStatementDataRow($Worksheet, $Row, $HeaderInfo) {
    foreach ($key in @("date", "description", "debit", "credit", "balance")) {
        if (-not $HeaderInfo.Map.ContainsKey($key)) {
            return $false
        }
        $cell = $Worksheet.Cells.Item($Row, $HeaderInfo.Map[$key])
        if ($null -eq $cell) {
            return $false
        }
    }
    return $true
}

function Update-StatementHeaderCell($Cell, $Payload) {
    $text = (Get-CellText $Cell).Trim()
    if ([string]::IsNullOrWhiteSpace($text)) {
        return
    }

    $low = $text.ToLowerInvariant()
    $replacement = $null

    if ($low -like "account holder*name*" -or $low -like "account holder*" -or $low -like "account name*") {
        $replacement = Replace-ValueKeepingLabel $text $Payload.account.customer_name
    } elseif ($low -match "^name\s*:") {
        $replacement = Replace-ValueKeepingLabel $text $Payload.account.customer_name
    } elseif ($low -like "address*" -or $low -like "permanent address*") {
        $replacement = Replace-ValueKeepingLabel $text $Payload.account.customer_address
    } elseif ($low -like "*a/c no*" -and $low -like "*member id*") {
        $replacement = "A/C No.: $($Payload.account.account_number)                    Member ID: $($Payload.account.member_id)"
    } elseif ($low -like "*account no*" -or $low -like "*a/c no*" -or $low -like "*a/c no.*") {
        $replacement = Replace-ValueKeepingLabel $text $Payload.account.account_number
    } elseif ($low -like "*account type*" -or $low -like "*a/c type*") {
        $replacement = Replace-ValueKeepingLabel $text $Payload.account.account_type
    } elseif ($low -like "*currency*") {
        $replacement = Replace-ValueKeepingLabel $text $Payload.account.currency
    } elseif ($low -like "*a/c opening date*") {
        $replacement = Replace-ValueKeepingLabel $text $Payload.account.opening_date_iso
    } elseif ($low -like "*interest rate*" -and $low -like "*tax*") {
        $replacement = "Interest Rate : $($Payload.rates.interest_rate)%, Tax : $($Payload.rates.tax_rate)%"
    } elseif ($low -like "*interest rate*") {
        $replacement = Replace-ValueKeepingLabel $text "$($Payload.rates.interest_rate)%"
    } elseif ($low -like "*tax rate*" -or ($low -eq "tax" -or $low -like "tax*")) {
        $replacement = Replace-ValueKeepingLabel $text "$($Payload.rates.tax_rate)%"
    } elseif ($low -like "from * to *") {
        $replacement = "FROM $($Payload.statement.period_from_iso) TO $($Payload.statement.period_to_iso)"
    } elseif ($low -like "*statement of account from*") {
        $replacement = "Statement of Account From $($Payload.statement.period_from_slash) to $($Payload.statement.period_to_slash)"
    } elseif ($low -like "*statement from*") {
        $replacement = "STATEMENT FROM $($Payload.statement.period_from_slash) TO $($Payload.statement.period_to_slash)"
    } elseif ($low -like "*account statement period*") {
        $replacement = "Account Statement Period: $($Payload.statement.period_from_iso) to $($Payload.statement.period_to_iso)"
    } elseif ($low -like "date*:-*" -or $low -like "date*:*") {
        $replacement = Replace-ValueKeepingLabel $text $Payload.statement.issue_date_slash
    }

    if ($null -ne $replacement -and $replacement -ne $text) {
        Set-TextValue $Cell $replacement
    }
}

function Update-StatementHeaderPair($Worksheet, $Row, $Col, $MaxColumn, $Payload) {
    if ($Col -ge $MaxColumn) {
        return $false
    }

    $labelCell = $Worksheet.Cells.Item($Row, $Col)
    $labelText = (Get-CellText $labelCell).Trim()
    if ([string]::IsNullOrWhiteSpace($labelText)) {
        return $false
    }

    $valueCell = $Worksheet.Cells.Item($Row, $Col + 1)
    $valueText = (Get-CellText $valueCell).Trim()
    if ([string]::IsNullOrWhiteSpace($valueText)) {
        return $false
    }
    if ($labelText.Length -gt 40 -or $valueText.Contains(":") -or $valueText -match "(?i)\b(name|address|account|interest|tax)\b") {
        return $false
    }

    $low = $labelText.ToLowerInvariant()
    if ($low -match "^(name|account name)\s*:?" -or $low -like "account holder*") {
        Set-TextValue $valueCell $Payload.account.customer_name
        return $true
    }
    if ($low -match "^address\s*:?" -or $low -like "permanent address*") {
        Set-TextValue $valueCell $Payload.account.customer_address
        return $true
    }
    if ($low -match "^(a/c no|account no)") {
        Set-TextValue $valueCell $Payload.account.account_number
        return $true
    }
    if ($low -match "^(a/c type|account type)") {
        Set-TextValue $valueCell $Payload.account.account_type
        return $true
    }
    if ($low -match "^interest") {
        $interestRate = Convert-ToNullableDouble $Payload.rates.interest_rate
        if ($null -ne $interestRate) {
            Set-NumberValue $valueCell ($interestRate / 100.0) "0.00%"
        }
        return $true
    }
    if ($low -match "^tax") {
        $taxRate = Convert-ToNullableDouble $Payload.rates.tax_rate
        if ($null -ne $taxRate) {
            Set-NumberValue $valueCell ($taxRate / 100.0) "0.00%"
        }
        return $true
    }
    return $false
}

function Expand-StatementRows($Worksheet, $DataRange, $RequiredCount) {
    $needed = $RequiredCount - $DataRange.Capacity
    if ($needed -le 0) {
        return
    }

    foreach ($table in $Worksheet.ListObjects) {
        $tableRange = $table.Range
        $tableStart = $tableRange.Row
        $tableEnd = $tableRange.Row + $tableRange.Rows.Count - 1
        if ($DataRange.Start -ge $tableStart -and $DataRange.End -le $tableEnd) {
            for ($index = 0; $index -lt $needed; $index++) {
                $sourceRange = $table.ListRows.Item($table.ListRows.Count).Range
                $newRow = $table.ListRows.Add()
                $sourceRange.Copy() | Out-Null
                $newRow.Range.PasteSpecial(-4122) | Out-Null
                $newRow.Range.RowHeight = $sourceRange.RowHeight
            }
            $Worksheet.Application.CutCopyMode = $false
            return
        }
    }

    $templateRow = [Math]::Max($DataRange.Start - 1, $DataRange.End)
    $insertRow = $DataRange.End + 1
    for ($index = 0; $index -lt $needed; $index++) {
        $Worksheet.Rows.Item($templateRow).Copy() | Out-Null
        $Worksheet.Rows.Item($insertRow).Insert() | Out-Null
    }
    $Worksheet.Application.CutCopyMode = $false
}

function Remove-UnusedStatementRows($Worksheet, $DataRange, $RequiredCount) {
    $firstExtra = $DataRange.Start + $RequiredCount
    if ($firstExtra -gt $DataRange.End) {
        return
    }
    for ($row = $DataRange.End; $row -ge $firstExtra; $row--) {
        $Worksheet.Rows.Item($row).Delete() | Out-Null
    }
}

function Compose-Description($BaseDescription, $ChequeNo, $SampleDescription, $HasChequeColumn) {
    $baseText = Convert-ToText $BaseDescription
    $chequeText = Convert-ToText $ChequeNo
    if ($HasChequeColumn -or [string]::IsNullOrWhiteSpace($chequeText)) {
        return $baseText
    }
    $sampleSource = Convert-ToText $SampleDescription
    $sampleLower = $sampleSource.ToLowerInvariant()
    if ($sampleLower.Contains("chq")) {
        return "$baseText CHQ. No. $chequeText"
    }
    if ($sampleLower.Contains("cheque")) {
        return "$baseText Cheque No. $chequeText"
    }
    return "$baseText CHQ. No. $chequeText"
}

function Get-StatementAmountTotal($Payload, $ColumnName) {
    $summaryProperty = if ($ColumnName -eq "debit") { "total_debit" } else { "total_credit" }
    if ($Payload.summary.PSObject.Properties.Name -contains $summaryProperty) {
        $summaryValue = Convert-ToNullableDouble $Payload.summary.$summaryProperty
        if ($null -ne $summaryValue) {
            return $summaryValue
        }
    }
    $total = 0.0
    foreach ($row in $Payload.statement_rows) {
        $property = $row.PSObject.Properties[$ColumnName]
        $value = if ($null -ne $property) { Convert-ToNullableDouble $property.Value } else { $null }
        if ($null -ne $value) {
            $total += $value
        }
    }
    return [double]$total
}

function Set-BoldRowCells($Worksheet, $Row, $Columns) {
    foreach ($col in $Columns) {
        $cell = $Worksheet.Cells.Item($Row, $col)
        $cell.Font.Bold = $true
    }
}

function Write-StatementTotalsRow($Worksheet, $HeaderInfo, $DataRange, $Payload) {
    $totalRow = $DataRange.Start + $Payload.statement_rows.Count
    if (-not (Test-TransactionTotalRow $Worksheet $totalRow $HeaderInfo)) { return 0 }

    Set-TextValue $Worksheet.Cells.Item($totalRow, $HeaderInfo.Map["description"]) "Total"
    Set-NumberValue $Worksheet.Cells.Item($totalRow, $HeaderInfo.Map["debit"]) (Get-StatementAmountTotal $Payload "debit") '_-* #,##0.00_-;\-* #,##0.00_-;_-* "-"??_-;_-@_-'
    Set-NumberValue $Worksheet.Cells.Item($totalRow, $HeaderInfo.Map["credit"]) (Get-StatementAmountTotal $Payload "credit") '_-* #,##0.00_-;\-* #,##0.00_-;_-* "-"??_-;_-@_-'
    Set-NumberValue $Worksheet.Cells.Item($totalRow, $HeaderInfo.Map["balance"]) $Payload.summary.final_balance '_-* #,##0.00_-;\-* #,##0.00_-;_-* "-"??_-;_-@_-'
    $usedDateColumns = @{}
    foreach ($dateKey in @("txn_date", "value_date", "date")) {
        if (-not $HeaderInfo.Map.ContainsKey($dateKey)) {
            continue
        }
        $dateCol = [int]$HeaderInfo.Map[$dateKey]
        if ($usedDateColumns.ContainsKey($dateCol)) {
            continue
        }
        $usedDateColumns[$dateCol] = $true
        Clear-CellValue $Worksheet.Cells.Item($totalRow, $dateCol)
    }
    if ($HeaderInfo.Map.ContainsKey("cheque")) {
        Clear-CellValue $Worksheet.Cells.Item($totalRow, $HeaderInfo.Map["cheque"])
    }
    Set-BoldRowCells $Worksheet $totalRow @($HeaderInfo.Map["description"], $HeaderInfo.Map["debit"], $HeaderInfo.Map["credit"], $HeaderInfo.Map["balance"])
    return $totalRow
}

function Resolve-SummaryReplacement($Text, $Payload) {
    $lower = (Convert-ToText $Text).Trim().ToLowerInvariant()
    if ([string]::IsNullOrWhiteSpace($lower)) {
        return $null
    }
    if (($lower -like "*debit*total*" -or $lower -like "*total*debit*" -or $lower -like "*debit*amount*") -and $lower -notlike "*tax*") {
        return Get-StatementAmountTotal $Payload "debit"
    }
    if (($lower -like "*credit*total*" -or $lower -like "*total*credit*" -or $lower -like "*credit*amount*") -and $lower -notlike "*interest*") {
        return Get-StatementAmountTotal $Payload "credit"
    }
    if ($lower -like "*closing*balance*" -or $lower -like "*final*balance*" -or $lower -like "*balance*total*" -or $lower -like "*total*balance*" -or $lower -like "*available*balance*" -or $lower -like "*avaiable*balance*") {
        return Convert-ToNullableDouble $Payload.summary.final_balance
    }
    if ($lower -like "*total*deposit*") {
        return Convert-ToNullableDouble $Payload.summary.total_deposits
    }
    if ($lower -like "*total*withdraw*") {
        return Convert-ToNullableDouble $Payload.summary.total_withdrawals
    }
    if ($lower -like "*total*interest*") {
        return Convert-ToNullableDouble $Payload.summary.total_interest
    }
    if ($lower -like "*total*tax*") {
        return Convert-ToNullableDouble $Payload.summary.total_tax
    }
    return $null
}

function Resolve-SummaryValueCell($Worksheet, $Row, $Col, $LastRow, $LastCol, $PreferBelow) {
    if ($PreferBelow -and $Row -lt $LastRow) {
        $below = $Worksheet.Cells.Item($Row + 1, $Col)
        $belowText = (Get-CellText $below).Trim().ToLowerInvariant()
        if ([string]::IsNullOrWhiteSpace($belowText) -or ($belowText -notlike "*total*" -and $belowText -notlike "*entries*")) {
            return $below
        }
    }

    for ($candidateCol = $Col + 1; $candidateCol -le $LastCol; $candidateCol++) {
        $candidate = $Worksheet.Cells.Item($Row, $candidateCol)
        $candidateText = (Get-CellText $candidate).Trim().ToLowerInvariant()
        if ([string]::IsNullOrWhiteSpace($candidateText) -or ($candidateText -notlike "*total*" -and $candidateText -notlike "*entries*")) {
            return $candidate
        }
    }

    if ($Row -lt $LastRow) {
        $below = $Worksheet.Cells.Item($Row + 1, $Col)
        $belowText = (Get-CellText $below).Trim().ToLowerInvariant()
        if ([string]::IsNullOrWhiteSpace($belowText) -or ($belowText -notlike "*total*" -and $belowText -notlike "*entries*")) {
            return $below
        }
    }

    return $Worksheet.Cells.Item($Row, [Math]::Min($Col + 1, $LastCol))
}

function Normalize-SummaryLabelText($Text) {
    $textValue = Convert-ToText $Text
    if ($textValue -match "^(.*?)(\s*:-\s*|\s*:\s*).*$") {
        $label = $matches[1].TrimEnd()
        $separator = if ($textValue -match ":-") { " :-" } else { ":" }
        return "$label$separator"
    }
    return $textValue
}

function Update-StatementSummaryCells($Worksheet, $HeaderInfo, $DataRange, $Payload, $TotalsRow) {
    $used = $Worksheet.UsedRange
    $lastRow = $used.Row + $used.Rows.Count - 1
    $lastCol = [Math]::Min($used.Column + $used.Columns.Count - 1, 12)
    $dataEnd = $DataRange.Start + $Payload.statement_rows.Count - 1
    for ($row = $used.Row; $row -le $lastRow; $row++) {
        if ($row -ge $DataRange.Start -and $row -le $dataEnd) {
            continue
        }
        $summaryLabels = @()
        for ($col = $used.Column; $col -le $lastCol; $col++) {
            $cell = $Worksheet.Cells.Item($row, $col)
            $text = (Get-CellText $cell).Trim()
            $replacement = Resolve-SummaryReplacement $text $Payload
            if ($null -eq $replacement) {
                continue
            }
            $summaryLabels += @{
                Col = $col
                Text = $text
                Replacement = $replacement
            }
        }
        $preferBelow = $summaryLabels.Count -gt 1
        foreach ($label in $summaryLabels) {
            $col = [int]$label.Col
            $text = [string]$label.Text
            $replacement = $label.Replacement
            $labelCell = $Worksheet.Cells.Item($row, $col)
            $cleanLabel = Normalize-SummaryLabelText $text
            if ($cleanLabel -ne $text) {
                Set-TextValue $labelCell $cleanLabel
            }
            $targetCell = Resolve-SummaryValueCell $Worksheet $row $col $lastRow $lastCol $preferBelow
            Set-NumberValue $targetCell $replacement '_-* #,##0.00_-;\-* #,##0.00_-;_-* "-"??_-;_-@_-'
            $targetCell.Font.Bold = $true
        }
    }
}

function Update-StatementWorkbook($Payload) {
    Copy-Item -LiteralPath $TemplatePath -Destination $OutputPath -Force
    $excel = New-Object -ComObject Excel.Application
    $excel.Visible = $false
    $excel.DisplayAlerts = $false

    try {
        $excel.AutomationSecurity = 3
        $excel.AskToUpdateLinks = $false
        $workbook = $excel.Workbooks.Open($OutputPath, 0)
        $selectedSheet = $null
        $headerInfo = $null
        foreach ($worksheet in $workbook.Worksheets) {
            $candidate = Find-HeaderInfo $worksheet
            if ($null -ne $candidate) {
                $selectedSheet = $worksheet
                $headerInfo = $candidate
                break
            }
        }

        if ($null -eq $selectedSheet) {
            throw "Could not find a statement table header in the selected Excel template."
        }

        $dataRange = Find-DataRange $selectedSheet $headerInfo
        if ($Payload.statement_rows.Count -gt $dataRange.Capacity) {
            Expand-StatementRows $selectedSheet $dataRange $Payload.statement_rows.Count
            $dataRange.End = $dataRange.Start + $Payload.statement_rows.Count - 1
            $dataRange.Capacity = $Payload.statement_rows.Count
        }

        $headerMaxRow = [Math]::Min($headerInfo.Row - 1, 15)
        if ($headerMaxRow -gt 0) {
            for ($row = 1; $row -le $headerMaxRow; $row++) {
                $skipCols = @{}
                for ($col = 1; $col -le [Math]::Min($dataRange.MaxColumn, 10); $col++) {
                    if ($skipCols.ContainsKey($col)) {
                        continue
                    }
                    if (Update-StatementHeaderPair $selectedSheet $row $col ([Math]::Min($dataRange.MaxColumn, 10)) $Payload) {
                        $skipCols[$col + 1] = $true
                        continue
                    }
                    Update-StatementHeaderCell $selectedSheet.Cells.Item($row, $col) $Payload
                }
            }
        }

        $sampleDescription = (Get-CellText $selectedSheet.Cells.Item($dataRange.Start, $headerInfo.Map["description"])).Trim()
        $hasChequeColumn = $headerInfo.Map.ContainsKey("cheque")

        for ($index = 0; $index -lt $Payload.statement_rows.Count; $index++) {
            $row = $Payload.statement_rows[$index]
            $targetRow = $dataRange.Start + $index
            $debitValue = Convert-ToNullableDouble $row.debit
            $creditValue = Convert-ToNullableDouble $row.credit
            $usedDateColumns = @{}
            foreach ($dateKey in @("txn_date", "value_date", "date")) {
                if (-not $headerInfo.Map.ContainsKey($dateKey)) {
                    continue
                }
                $dateCol = [int]$headerInfo.Map[$dateKey]
                if ($usedDateColumns.ContainsKey($dateCol)) {
                    continue
                }
                $usedDateColumns[$dateCol] = $true
                $dateValue = $row.date
                if ($dateKey -eq "value_date" -and $row.PSObject.Properties["value_date"]) {
                    $dateValue = $row.value_date
                } elseif ($dateKey -eq "txn_date" -and $row.PSObject.Properties["txn_date"]) {
                    $dateValue = $row.txn_date
                }
                Set-DateValue $selectedSheet.Cells.Item($targetRow, $dateCol) $dateValue
            }
            $description = Compose-Description $row.description $row.cheque_no $sampleDescription $hasChequeColumn
            Set-TextValue $selectedSheet.Cells.Item($targetRow, $headerInfo.Map["description"]) $description
            if ($hasChequeColumn) {
                Set-IntegerValue $selectedSheet.Cells.Item($targetRow, $headerInfo.Map["cheque"]) $row.cheque_no
            }
            if ($null -ne $debitValue -and $debitValue -gt 0) {
                Set-NumberValue $selectedSheet.Cells.Item($targetRow, $headerInfo.Map["debit"]) $debitValue '_-* #,##0.00_-;\-* #,##0.00_-;_-* "-"??_-;_-@_-'
            } else {
                Clear-CellValue $selectedSheet.Cells.Item($targetRow, $headerInfo.Map["debit"])
            }
            if ($null -ne $creditValue -and $creditValue -gt 0) {
                Set-NumberValue $selectedSheet.Cells.Item($targetRow, $headerInfo.Map["credit"]) $creditValue '_-* #,##0.00_-;\-* #,##0.00_-;_-* "-"??_-;_-@_-'
            } else {
                Clear-CellValue $selectedSheet.Cells.Item($targetRow, $headerInfo.Map["credit"])
            }
            if ([string]::IsNullOrWhiteSpace((Convert-ToText $row.balance))) {
                throw "Balance value is missing for statement row $($index + 1)."
            }
            Set-NumberValue $selectedSheet.Cells.Item($targetRow, $headerInfo.Map["balance"]) $row.balance '_-* #,##0.00_-;\-* #,##0.00_-;_-* "-"??_-;_-@_-'
        }

        Remove-UnusedStatementRows $selectedSheet $dataRange $Payload.statement_rows.Count
        $dataRange.End = $dataRange.Start + $Payload.statement_rows.Count - 1
        $dataRange.Capacity = $Payload.statement_rows.Count
        $totalsRow = Write-StatementTotalsRow $selectedSheet $headerInfo $dataRange $Payload
        Update-StatementSummaryCells $selectedSheet $headerInfo $dataRange $Payload $totalsRow
        foreach ($worksheet in $workbook.Worksheets) {
            Apply-WorksheetPrintSetup $worksheet
        }

        foreach ($sampleSheet in $workbook.Worksheets) {
            $sampleSheet.Rows.Item(1).Insert() | Out-Null
            $sampleSheet.Cells.Item(1, 1).Value2 = "SAMPLE - NOT A BANK-ISSUED DOCUMENT"
            $sampleSheet.Cells.Item(1, 1).Font.Bold = $true
            $sampleSheet.Cells.Item(1, 1).Font.Color = 164
            $sampleSheet.PageSetup.CenterHeader = "&B SAMPLE - NOT A BANK-ISSUED DOCUMENT"
            $sampleSheet.PageSetup.PrintArea = $sampleSheet.UsedRange.Address()
        }
        $workbook.Save()
        $workbook.Close($true)
    } finally {
        $excel.Quit()
        [System.Runtime.InteropServices.Marshal]::ReleaseComObject($excel) | Out-Null
        [gc]::Collect()
        [gc]::WaitForPendingFinalizers()
    }
}

function Get-UpdatedCertificateText($Text, $Payload) {
    $originalText = Convert-ToText $Text
    $trimmed = $originalText.Trim()
    if ([string]::IsNullOrWhiteSpace($trimmed)) {
        return $originalText
    }

    $expanded = Expand-PayloadTokens $trimmed $Payload
    if ($expanded -ne $trimmed) { return $expanded }
    $trimmed = $expanded
    $lower = $trimmed.ToLowerInvariant()
    if ($trimmed -match '^(?i)(ref\.?\s*(?:no\.?|number)?\s*:\s*)(.*?)(\t+| {2,})(date\s*:\s*)(.*)$') {
        return $Matches[1] + (Convert-ToText $Payload.account.reference_no) + $Matches[3] + $Matches[4] + (Convert-ToText $Payload.statement.issue_date_slash)
    }
    if ($trimmed -match '^(?i)((?:name|account holder|address|permanent address|a/c no\.?|account no\.?|account number|a/c type|account type|total balance(?: npr)?|in words(?: npr| usd)?|equivalent(?: to)? usd|issue date|reference no\.?)\s*:\s*)(.*)$') {
        $prefix = $Matches[1]
        $field = Resolve-CertificateFieldValue $prefix $Payload
        if ($null -ne $field) { return $prefix + $field }
    }
    if ($lower -like "ref. no*") {
        if ([string]::IsNullOrWhiteSpace((Convert-ToText $Payload.account.reference_no))) {
            return [regex]::Replace($trimmed, "(?i)date\s*:\s*.*$", "Date: $($Payload.statement.issue_date_slash)")
        }
        return "Ref. No.: $($Payload.account.reference_no)    Date: $($Payload.statement.issue_date_slash)"
    }
    if ($lower -match "^issue date\s*:") { return "Issue Date: $($Payload.statement.issue_date_slash)" }
    if ($lower -match "^date\s*:") { return "Date: $($Payload.statement.issue_date_slash)" }
    if ($lower -like "this is to certify*" -and $lower.Contains("under mentioned account holder")) {
        return "This is to certify that the balance in the credit of the under mentioned Account Holder as on $($Payload.statement.as_of_ordinal) is mentioned below."
    }
    if ($lower -match "^name\s*:") { return "Name: $($Payload.account.customer_name)" }
    if ($lower -like "account holder:*") { return "Account Holder: $($Payload.account.customer_name)" }
    if ($lower -match "^address\s*:") { return "Address: $($Payload.account.customer_address)" }
    if ($lower -match "^permanent address\s*:") { return "Permanent Address: $($Payload.account.customer_address)" }
    if ($lower -like "a/c no*" -and $lower -like "*member id*") {
        return "A/C No.: $($Payload.account.account_number)                    Member ID: $($Payload.account.member_id)"
    }
    if ($lower -match "^a/c no") { return "A/C No.: $($Payload.account.account_number)" }
    if ($lower -match "^account no") { return "Account No.: $($Payload.account.account_number)" }
    if ($lower -like "member id*") { return "Member ID: $($Payload.account.member_id)" }
    if ($lower -match "^a/c type") { return "A/C Type: $($Payload.account.account_type)" }
    if ($lower -match "^account type") { return "Account Type: $($Payload.account.account_type)" }
    if ($lower -like "interest rate*") { return "Interest Rate: $($Payload.rates.interest_rate) %" }
    if ($lower -like "currency*") { return "Currency: $($Payload.account.currency)" }
    if ($lower -like "total balance npr*") { return "Total Balance NPR: $($Payload.certificate.total_balance_npr_text)" }
    if ($lower -like "total balance:*") { return "Total Balance: NPR $($Payload.certificate.total_balance_npr_text)" }
    if ($lower -like "has a balance of*") { return "Has a balance of: NPR $($Payload.certificate.total_balance_npr_text)" }
    if ($lower -like "equivalent to usd*") { return "Equivalent to USD: $($Payload.certificate.equivalent_usd_text)" }
    if ($lower -like "usd:*") { return "USD: $($Payload.certificate.equivalent_usd_text)" }
    if ($lower -like "which is equivalent to*") { return "Which is equivalent to: USD $($Payload.certificate.equivalent_usd_text)" }
    if ($lower -like "in words usd*" -or $lower -like "(in words) usd*") {
        $label = ($trimmed -split ":", 2)[0]
        return "${label}: $($Payload.certificate.balance_words_usd)"
    }
    if ($lower -like "(in words:*") {
        return "(In Words: $($Payload.certificate.balance_words_npr))"
    }
    if ($lower -match "^(in words(?: npr)?|amount in words)\s*:") { return "In Words NPR: $($Payload.certificate.balance_words_npr)" }
    if ($lower.Contains("exchange rate")) {
        if ($lower.Contains("today")) {
            return "Note: Conversion has been done as per issue day exchange rate 1 USD = NPR $($Payload.rates.usd_npr_text)"
        }
        if ($lower.Contains("as of")) {
            return "The exchange rate as of $($Payload.statement.issue_date_ordinal) is 1 USD = $($Payload.rates.usd_npr_text) NPR"
        }
        if ($lower.Contains("source:")) {
            return "At prevailing exchange rate of USD 1 = NPR $($Payload.rates.usd_npr_text) (Source: Nepal Rastra Bank)"
        }
        return "At prevailing exchange rate of USD 1 = NPR $($Payload.rates.usd_npr_text)"
    }

    return $trimmed
}

function Resolve-CertificateFieldValue($LabelText, $Payload) {
    $lower = (Convert-ToText $LabelText).Trim().ToLowerInvariant()
    if ([string]::IsNullOrWhiteSpace($lower)) {
        return $null
    }
    if ($lower -match "^exchange.*rate") { return "1 USD = NPR $($Payload.rates.usd_npr_text)" }
    if ($lower -match "\b(ref|reference)\b") { return Convert-ToText $Payload.account.reference_no }
    if ($lower -match "\b(issue\s*)?date\b") { return Convert-ToText $Payload.statement.issue_date_slash }
    if ($lower -match "\b(name|account holder|customer)\b") { return Convert-ToText $Payload.account.customer_name }
    if ($lower -match "\baddress\b") { return Convert-ToText $Payload.account.customer_address }
    if ($lower -match "\b(a/c|account)\s*(no|number)\b") { return Convert-ToText $Payload.account.account_number }
    if ($lower -match "\bmember\b") { return Convert-ToText $Payload.account.member_id }
    if ($lower -match "\b(a/c|account)\s*type\b") { return Convert-ToText $Payload.account.account_type }
    if ($lower -match "\bcurrency\b") { return Convert-ToText $Payload.account.currency }
    if ($lower -match "\binterest\b" -and $lower -match "\brate\b") { return "$($Payload.rates.interest_rate) %" }
    if ($lower -match "\bexchange\b" -and $lower -match "\brate\b") { return "1 USD = NPR $($Payload.rates.usd_npr_text)" }
    if ($lower -match "\busd\b" -and $lower -match "\bword") { return Convert-ToText $Payload.certificate.balance_words_usd }
    if ($lower -match "\busd\b") { return Convert-ToText $Payload.certificate.equivalent_usd_text }
    if ($lower -match "\bword") { return Convert-ToText $Payload.certificate.balance_words_npr }
    if ($lower -match "\bbalance\b") { return Convert-ToText $Payload.certificate.total_balance_npr_text }
    return $null
}

function Set-WordCellText($Cell, $Value) {
    $text = Convert-ToText $Value
    $range = $Cell.Range
    if ($range.End -gt $range.Start) {
        $range.End = $range.End - 1
    }
    $range.Text = $text
}

function Apply-CertificateTablePairUpdates($Row, $Payload) {
    $changed = $false
    for ($index = 1; $index -lt $Row.Cells.Count; $index++) {
        $labelText = (Convert-ToText $Row.Cells.Item($index).Range.Text).Replace([string][char]13, "").Replace([string][char]7, "").Trim()
        if ($labelText -notmatch '^(?i)(name|account holder|customer name|address|permanent address|a/c (no\.?|number|type)|account (no\.?|number|type)|member id|currency|interest rate|exchange rate(?: on issue date)?|(?:issue )?date|ref(?:erence)?[ .]*(?:no\.?|number)?|(?:total |final )?balance(?: npr)?|equivalent(?: to)? usd|in words(?: npr| usd)?|amount in words)\s*[:.-]*$') { continue }
        $value = Resolve-CertificateFieldValue $labelText $Payload
        if ($null -ne $value) {
            Set-WordCellText $Row.Cells.Item($index + 1) $value
            $index++
            $changed = $true
        }
    }
    return $changed
}

function Apply-ParagraphUpdate($Paragraph, $Payload) {
    $original = Convert-ToText $Paragraph.Range.Text
    $clean = $original.TrimEnd([char]13, [char]7)
    $updated = Get-UpdatedCertificateText $clean $Payload
    if ($updated -ne $clean) {
        $prefix = 0
        while ($prefix -lt $clean.Length -and $prefix -lt $updated.Length -and $clean[$prefix] -ceq $updated[$prefix]) { $prefix++ }
        $suffix = 0
        while ($suffix -lt ($clean.Length - $prefix) -and $suffix -lt ($updated.Length - $prefix) -and $clean[$clean.Length-1-$suffix] -ceq $updated[$updated.Length-1-$suffix]) { $suffix++ }
        $range = $Paragraph.Range.Duplicate
        $start = $range.Start
        $range.SetRange($start + $prefix, $start + $clean.Length - $suffix)
        $range.Text = $updated.Substring($prefix, $updated.Length - $prefix - $suffix)
    }
}

function Update-CertificateDocument($Payload) {
    Copy-Item -LiteralPath $TemplatePath -Destination $OutputPath -Force
    $word = New-Object -ComObject Word.Application
    $word.Visible = $false
    $word.DisplayAlerts = 0
    $word.AutomationSecurity = 3

    try {
        $document = $word.Documents.Open($OutputPath, $false, $false)
        Apply-DocumentPrintSetup $document
        foreach ($story in $document.StoryRanges) {
            $currentStory = $story
            while ($null -ne $currentStory) {
                foreach ($paragraph in $currentStory.Paragraphs) {
                    if (-not $paragraph.Range.Information(12)) { Apply-ParagraphUpdate $paragraph $Payload }
                }
                $currentStory = $currentStory.NextStoryRange
            }
        }
        foreach ($table in $document.Tables) {
            foreach ($row in $table.Rows) {
                $paired = Apply-CertificateTablePairUpdates $row $Payload
                if ($paired) { continue }
                foreach ($cell in $row.Cells) {
                    foreach ($paragraph in $cell.Range.Paragraphs) {
                        Apply-ParagraphUpdate $paragraph $Payload
                    }
                }
            }
        }
        $sampleRange = $document.Range(0, 0)
        $sampleRange.InsertBefore("SAMPLE - NOT A BANK-ISSUED DOCUMENT`r")
        $document.Paragraphs.Item(1).Range.Font.Bold = $true
        $document.Paragraphs.Item(1).Range.Font.Color = 164
        foreach ($section in $document.Sections) {
            foreach ($header in $section.Headers) {
                $labelRange = $header.Range.Duplicate
                $labelRange.Collapse(0)
                $labelRange.InsertBefore("`rSAMPLE - NOT A BANK-ISSUED DOCUMENT")
                $labelRange.Font.Bold = $true
                $labelRange.Font.Color = 164
            }
        }
        $document.Save()
        $document.Close($true)
    } finally {
        $word.Quit()
        [System.Runtime.InteropServices.Marshal]::ReleaseComObject($word) | Out-Null
        [gc]::Collect()
        [gc]::WaitForPendingFinalizers()
    }
}

$payload = Read-Payload

if ($Mode -eq "statement") {
    Update-StatementWorkbook $payload
} else {
    Update-CertificateDocument $payload
}
