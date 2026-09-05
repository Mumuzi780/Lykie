@echo off
cd /d "%~dp0"

title Lykie ��������
set LYKIE_OPEN_BROWSER=0
set LYKIE_HOST=127.0.0.1
set LYKIE_PORT=5000

echo ========================================
echo   �������֣���������
echo   ����: http://127.0.0.1:5000/
echo   �������ñ���������������������ַ
echo   �رձ����ڼ�ֹͣ����
echo ========================================
echo.

where python >nul 2>&1
if errorlevel 1 (
  echo [����] δ�ҵ� python�����ڱ�����װ Python 3.10+ ������ PATH��
  pause
  exit /b 1
)

python -m pip install -r requirements.txt -q
python app.py
if errorlevel 1 (
  echo.
  echo [����] ����ʧ�ܡ�
  pause
)
