/**
 * app.js
 * PPG解析アプリケーションのメインスクリプト
 */

// グローバル変数として SignalProcessor が存在するか確認
if (typeof SignalProcessor === 'undefined') {
    console.error('SignalProcessor クラスがロードされていません。signal-processing.js の読み込みを確認してください。');
}

// アプリケーションの初期化
document.addEventListener('DOMContentLoaded', function() {
    // DOM要素の取得
    const videoElement = document.getElementById('video');
    const canvasElement = document.getElementById('canvas');
    const startButton = document.getElementById('start-btn');
    const stopButton = document.getElementById('stop-btn');
    const errorMessage = document.getElementById('error-message');
    const heartRateDisplay = document.getElementById('heart-rate-display');
    const heartRateElement = document.getElementById('heart-rate');
    const avgRriElement = document.getElementById('avg-rri');
    const ppgGraph = document.getElementById('ppg-graph');
    const rriGraph = document.getElementById('rri-graph');
    const lfGraph = document.getElementById('lf-graph');
    const hfGraph = document.getElementById('hf-graph');
    const lfiaGraph = document.getElementById('lfia-graph');
    const hfiaGraph = document.getElementById('hfia-graph');
    const scatterGraph = document.getElementById('scatter-graph');
    const ppgMax = document.getElementById('ppg-max');
    const ppgMin = document.getElementById('ppg-min');
    const cameraSelect = document.getElementById('camera-select');
    const debugToggle = document.getElementById('debug-toggle');
    const debugContainer = document.getElementById('debug-container');
    const peakCountElement = document.getElementById('peak-count');
    const currentPpgElement = document.getElementById('current-ppg');
    const framerateElement = document.getElementById('framerate');
    const lfiaValueElement = document.getElementById('lfia-value');
    const hfiaValueElement = document.getElementById('hfia-value');
    
    // カメラプロセッサとシグナルプロセッサの初期化
    const cameraProcessor = new CameraProcessor();
    cameraProcessor.initialize(videoElement, canvasElement);
    
    // コールバック関数を設定
    cameraProcessor.setCallbacks({
        onPpgUpdate: updatePpgGraph,
        onRriUpdate: updateRriGraph,
        onFrameRateUpdate: updateFrameRate,
        onPeakDetected: updatePeakCount
    });
    
    // 録画状態
    let isRecording = false;
    
    // デバッグ表示の切り替え
    debugToggle.addEventListener('click', function() {
        if (debugContainer.style.display === 'none' || !debugContainer.style.display) {
            debugContainer.style.display = 'block';
            debugToggle.textContent = 'デバッグ情報を隠す';
        } else {
            debugContainer.style.display = 'none';
            debugToggle.textContent = 'デバッグ情報を表示';
        }
    });
    
    // 利用可能なカメラデバイスを列挙
    async function getDevices() {
        try {
            const devices = await cameraProcessor.getDevices();
            
            // セレクトボックスをクリア
            cameraSelect.innerHTML = '';
            
            // デバイスがない場合
            if (devices.length === 0) {
                const option = document.createElement('option');
                option.text = 'カメラが見つかりません';
                cameraSelect.add(option);
                showError('カメラが見つかりません');
                return;
            }
            
            // デバイスをセレクトボックスに追加
            devices.forEach((device, index) => {
                const option = document.createElement('option');
                option.value = device.deviceId;
                option.text = device.label || `カメラ ${index + 1}`;
                cameraSelect.add(option);
            });
            
            hideError();
        } catch (err) {
            showError('カメラデバイスの取得に失敗しました: ' + err.message);
        }
    }
    
    // 録画開始
    async function startRecording() {
        try {
            const success = await cameraProcessor.startCamera(cameraSelect.value);
            if (!success) {
                showError('カメラの起動に失敗しました');
                return;
            }
            
            isRecording = true;
            startButton.style.display = 'none';
            stopButton.style.display = 'block';
            
            // グラフをクリア
            clearGraphs();
            
            // 心拍数表示を隠す
            heartRateDisplay.style.display = 'none';
            
            // 録画開始
            await cameraProcessor.startRecording();
            
            hideError();
        } catch (err) {
            showError('録画の開始に失敗しました: ' + err.message);
        }
    }
    
    // 録画停止
    function stopRecording() {
        isRecording = false;
        startButton.style.display = 'block';
        stopButton.style.display = 'none';
        
        // 録画停止
        cameraProcessor.stopRecording();
    }
    
    // グラフをクリア
    function clearGraphs() {
        ppgGraph.innerHTML = '';
        rriGraph.innerHTML = '';
        lfGraph.innerHTML = '';
        hfGraph.innerHTML = '';
        lfiaGraph.innerHTML = '';
        hfiaGraph.innerHTML = '';
        scatterGraph.innerHTML = '';
    }
    
    // PPGグラフを更新
    function updatePpgGraph(ppgData, timeValues) {
        if (ppgData.length === 0) return;
        
        // グラフをクリア
        ppgGraph.innerHTML = '';
        
        const values = [...ppgData];
        const min = Math.min(...values);
        const max = Math.max(...values);
        const range = max - min || 1;
        
        // ラベルを更新
        ppgMax.textContent = max.toFixed(2);
        ppgMin.textContent = min.toFixed(2);
        
        // 現在のPPG値を表示
        if (currentPpgElement) {
            currentPpgElement.textContent = values[values.length - 1].toFixed(2);
        }
        
        // グラフを描画
        values.forEach((value, index) => {
            const bar = document.createElement('div');
            bar.className = 'ppg-bar';
            bar.style.left = `${(index / (values.length - 1)) * 100}%`;
            bar.style.height = `${((value - min) / range) * 100}%`;
            ppgGraph.appendChild(bar);
        });
    }
    
    // RRIグラフを更新
    function updateRriGraph(rriData) {
        if (rriData.length === 0) return;
        
        // グラフをクリア
        rriGraph.innerHTML = '';
        
        const values = [...rriData];
        const min = 600; // 最小600ms
        const max = 1200; // 最大1200ms
        const range = max - min;
        
        // 心拍数を計算（直近5つのRRIの平均から）
        const recentRri = values.slice(-5);
        if (recentRri.length > 0) {
            const avgRri = recentRri.reduce((sum, val) => sum + val, 0) / recentRri.length;
            const hr = Math.round(60000 / avgRri);
            
            // 心拍数を表示（妥当な範囲内なら）
            if (hr >= 40 && hr <= 200) {
                heartRateElement.textContent = hr + ' BPM';
                avgRriElement.textContent = '平均RRI: ' + Math.round(avgRri) + ' ms';
                heartRateDisplay.style.display = 'block';
            }
        }
        
        // グラフを描画（最大20個表示）
        const displayValues = values.slice(-20);
        displayValues.forEach((value, index) => {
            const bar = document.createElement('div');
            bar.className = 'rri-bar';
            bar.style.left = `${(index / Math.max(19, displayValues.length - 1)) * 100}%`;
            bar.style.height = `${((value - min) / range) * 100}%`;
            rriGraph.appendChild(bar);
        });
    }
    
    // LF/HF/LFiA/HFiAグラフを更新
    function updateAdvancedGraphs() {
        if (!isRecording) return;
        
        // signal-processing.jsの結果を使用
        const processor = cameraProcessor.signalProcessor;
        
        // LFとHFのグラフを更新（データが存在する場合のみ）
        if (processor.lfBuffer && processor.lfBuffer.length > 0) {
            updateFrequencyGraph(lfGraph, processor.lfBuffer, 'lf-bar');
        }
        
        if (processor.hfBuffer && processor.hfBuffer.length > 0) {
            updateFrequencyGraph(hfGraph, processor.hfBuffer, 'hf-bar');
        }
        
        // LFiAとHFiAのグラフを更新（データが存在する場合のみ）
        if (processor.lfiaBuffer && processor.lfiaBuffer.length > 0) {
            updateFrequencyGraph(lfiaGraph, processor.lfiaBuffer, 'lfia-bar');
        }
        
        if (processor.hfiaBuffer && processor.hfiaBuffer.length > 0) {
            updateFrequencyGraph(hfiaGraph, processor.hfiaBuffer, 'hfia-bar');
        }
        
        // デバッグ情報を更新
        if (processor.lfiaBuffer && processor.lfiaBuffer.length > 0 && 
            processor.hfiaBuffer && processor.hfiaBuffer.length > 0) {
            
            const lfia = processor.lfiaBuffer[processor.lfiaBuffer.length - 1];
            const hfia = processor.hfiaBuffer[processor.hfiaBuffer.length - 1];
            
            // 無効な値をチェック
            lfiaValueElement.textContent = isFinite(lfia) ? lfia.toFixed(2) : "計算中...";
            hfiaValueElement.textContent = isFinite(hfia) ? hfia.toFixed(2) : "計算中...";
            
            // 散布図を更新（有効な値がある場合のみ）
            if (isFinite(lfia) && isFinite(hfia)) {
                updateScatterPlot(processor.lfiaBuffer, processor.hfiaBuffer);
            }
        }
        
        // 1秒ごとに更新
        setTimeout(updateAdvancedGraphs, 1000);
    }
    
    // 周波数帯域グラフを更新（改良版）
    function updateFrequencyGraph(graphElement, data, className) {
        if (!data || data.length === 0) return;
        
        // グラフをクリア
        graphElement.innerHTML = '';
        
        // データの有効性を確認
        const validData = data.filter(val => isFinite(val) && !isNaN(val));
        if (validData.length === 0) return;
        
        // データ範囲を計算
        const min = Math.min(...validData);
        const max = Math.max(...validData);
        const range = max - min || 1; // 0除算防止
        
        // 表示するデータポイントの数を制限（最大30ポイント）
        const displayData = validData.length > 30 ? 
                            validData.slice(-30) : validData;
        
        // グラフを描画（バーチャート）
        displayData.forEach((value, index) => {
            // 無効な値はスキップ
            if (!isFinite(value) || isNaN(value)) return;
            
            const bar = document.createElement('div');
            bar.className = className;
            bar.style.left = `${(index / (displayData.length - 1 || 1)) * 100}%`;
            
            // 値の正規化と高さの設定
            const normalizedHeight = ((value - min) / range) * 100;
            bar.style.height = `${Math.max(1, Math.min(100, normalizedHeight))}%`;
            
            graphElement.appendChild(bar);
        });
    }
    
    // 散布図を更新（改良版）
    function updateScatterPlot(lfiaData, hfiaData) {
        if (!lfiaData || !hfiaData || lfiaData.length === 0 || hfiaData.length === 0) return;
        
        // グラフをクリア
        scatterGraph.innerHTML = '';
        
        // 有効なデータポイントだけを使用
        const validPoints = [];
        const numPoints = Math.min(lfiaData.length, hfiaData.length);
        
        for (let i = 0; i < numPoints; i++) {
            const lfia = lfiaData[i];
            const hfia = hfiaData[i];
            
            // 無効な値をフィルタリング
            if (isFinite(lfia) && isFinite(hfia) && !isNaN(lfia) && !isNaN(hfia)) {
                validPoints.push({ lfia, hfia });
            }
        }
        
        if (validPoints.length === 0) return;
        
        // 最新の30ポイントのみ使用
        const displayPoints = validPoints.length > 30 ? 
                              validPoints.slice(-30) : validPoints;
        
        // LFiAとHFiAの範囲を計算
        const lfiaMin = Math.min(...displayPoints.map(p => p.lfia));
        const lfiaMax = Math.max(...displayPoints.map(p => p.lfia));
        const hfiaMin = Math.min(...displayPoints.map(p => p.hfia));
        const hfiaMax = Math.max(...displayPoints.map(p => p.hfia));
        
        // 範囲に少しマージンを追加
        const lfiaRange = (lfiaMax - lfiaMin) * 1.1 || 100;
        const hfiaRange = (hfiaMax - hfiaMin) * 1.1 || 100;
        
        // ポイントを描画
        displayPoints.forEach((point, i) => {
            const { lfia, hfia } = point;
            
            // 位置を計算（0-100%の範囲に正規化）
            const x = ((hfia - hfiaMin) / hfiaRange) * 100;
            const y = ((lfia - lfiaMin) / lfiaRange) * 100;
            
            // 範囲内にあることを確認
            if (x >= 0 && x <= 100 && y >= 0 && y <= 100) {
                const pointElement = document.createElement('div');
                pointElement.className = 'scatter-point';
                pointElement.style.left = `${x}%`;
                pointElement.style.bottom = `${y}%`;
                
                // 最新のポイントは大きく赤く表示
                if (i === displayPoints.length - 1) {
                    pointElement.style.width = '8px';
                    pointElement.style.height = '8px';
                    pointElement.style.backgroundColor = 'red';
                    pointElement.style.transform = 'translate(-4px, 4px)';
                }
                
                scatterGraph.appendChild(pointElement);
            }
        });
    }
    
    // フレームレートを更新
    function updateFrameRate(fps) {
        framerateElement.textContent = fps;
    }
    
    // ピーク数を更新
    function updatePeakCount(count) {
        peakCountElement.textContent = count;
    }
    
    // エラーメッセージを表示
    function showError(message) {
        errorMessage.textContent = message;
        errorMessage.style.display = 'block';
    }
    
    // エラーメッセージを非表示
    function hideError() {
        errorMessage.style.display = 'none';
    }
    
    // イベントリスナー
    startButton.addEventListener('click', startRecording);
    stopButton.addEventListener('click', stopRecording);
    cameraSelect.addEventListener('change', () => {
        if (isRecording) {
            stopRecording();
        }
    });
    
    // 高度な解析の更新開始
    function startAdvancedAnalysis() {
        if (isRecording) {
            updateAdvancedGraphs();
        } else {
            setTimeout(startAdvancedAnalysis, 1000);
        }
    }
    
    // 初期化
    getDevices();
    startAdvancedAnalysis();
});