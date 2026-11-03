@rem AntyShare Android Build Runner
@if "%DEBUG%"=="" @echo off

set JAVA_HOME=C:\Users\sende\.jdks\jbr-17.0.14
set ANDROID_HOME=C:\Users\sende\AppData\Local\Android\Sdk
set ANDROID_SDK_ROOT=C:\Users\sende\AppData\Local\Android\Sdk

"C:\Users\sende\.gradle\wrapper\dists\gradle-8.10.2-bin\a04bxjujx95o3nb99gddekhwo\gradle-8.10.2\bin\gradle.bat" %*
