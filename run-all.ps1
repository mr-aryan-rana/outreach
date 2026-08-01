$ErrorActionPreference = "Stop"
Write-Host "Starting all MakeAble services..."

Start-Process powershell -ArgumentList "-NoExit", "-Command", "`$host.ui.RawUI.WindowTitle = 'Backend API (Port 4000)'; cd apps/backend; npm install; npm run dev"
Start-Process powershell -ArgumentList "-NoExit", "-Command", "`$host.ui.RawUI.WindowTitle = 'Python Search (Port 8001)'; cd apps/python/search; pip install -r requirements.txt; python -m uvicorn main:app --port 8001"
Start-Process powershell -ArgumentList "-NoExit", "-Command", "`$host.ui.RawUI.WindowTitle = 'Python Extractor (Port 8002)'; cd apps/python/extractor; pip install -r requirements.txt; python -m uvicorn main:app --port 8002"
Start-Process powershell -ArgumentList "-NoExit", "-Command", "`$host.ui.RawUI.WindowTitle = 'Python Validator (Port 8003)'; cd apps/python/validator; pip install -r requirements.txt; python -m uvicorn main:app --port 8003"
Start-Process powershell -ArgumentList "-NoExit", "-Command", "`$host.ui.RawUI.WindowTitle = 'AI Service (Port 8004)'; cd apps/ai; npm install; npm run dev"
Start-Process powershell -ArgumentList "-NoExit", "-Command", "`$host.ui.RawUI.WindowTitle = 'Email API (Port 8005)'; cd apps/email; npm install; npm run dev"
Start-Process powershell -ArgumentList "-NoExit", "-Command", "`$host.ui.RawUI.WindowTitle = 'Email Worker'; cd apps/email; npm install; npm run worker"
Start-Process powershell -ArgumentList "-NoExit", "-Command", "`$host.ui.RawUI.WindowTitle = 'Admin Dashboard (Port 3000)'; cd apps/admin; npm install; npm run dev"

Write-Host "All services started in new windows!"
