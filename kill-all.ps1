$ports = 3000, 4000, 8001, 8002, 8003, 8004, 8005
foreach ($p in $ports) { 
    $conn = Get-NetTCPConnection -LocalPort $p -ErrorAction SilentlyContinue
    if ($conn) { 
        $conn | ForEach-Object { 
            Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue 
        } 
    } 
}
Write-Host "All MakeAble ports have been cleared!"
