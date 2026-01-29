#!/usr/bin/env pwsh
# Final comprehensive cleanup of role-based ensemble

$appFile = "c:\Users\rober\OneDrive\Documents\Code\august-3.5\App.tsx"

# Read file
$lines = Get-Content $appFile

# Find and remove the handler function by line numbers (around 754-1133)
$inHandler = $false  
$braceCount = 0
$newLines = @()

for ($i = 0; $i -lt $lines.Count; $i++) {
    $line = $lines[$i]
    
    # Start of handler function
    if ($line -match 'const handleRoleBasedEnsembleAnalysis = useCallback') {
        $inHandler = $true
        $braceCount = 0
        continue
    }
    
    # Track braces while in handler
    if ($inHandler) {
        $braceCount += ($line.ToCharArray() | Where-Object { $_ -eq '{' }).Count
        $braceCount -= ($line.ToCharArray() | Where-Object { $_ -eq '}' }).Count
        
        # End of handler when braces balance and we see closing );
        if ($braceCount -le 0 -and $line -match '^\s*\},\s*\[') {
            # Skip this line and the dependency array closing
            $inHandler = $false
            continue
        }
        continue
    }
    
    # Skip migration code block
    if ($line -match '// Migrate old Standard Ensemble') {
        while ($i -lt $lines.Count -and $lines[$i] -notmatch 'setRoleBasedEnsembleConfig\(undefined\);') {
            $i++
        }
        $i++ # Skip the setRoleBasedEnsembleConfig line too
        continue
    }
    
    # Skip state declarations
    if ($line -match 'const \[isRoleBasedEnsembleEnabled|const \[roleBasedEnsembleConfig') {
        continue
    }
    
    # Skip post-mortem block (if isRoleBasedEnsembleEnabled)
    if ($line -match 'if \(isRoleBasedEnsembleEnabled && roleBasedEnsembleConfig\)') {
        # Find the matching else block and convert to if (true)
        $newLines += "            if (true) {"
        # Skip lines until we find the matching else
        $depth = 1
        $i++
        while ($i -lt $lines.Count -and $depth -gt 0) {
            if ($lines[$i] -match '\{') { $depth++ }
            if ($lines[$i] -match '\}') { $depth-- }
            if ($depth -eq 1 -and $lines[$i] -match '^\s*\} else \{') {
                break
            }
            $i++
        }
        continue
    }
    
    # Add line if not skipped
    $newLines += $line
}

# Write back
$newLines | Set-Content $appFile

Write-Output "Final cleanup complete"
