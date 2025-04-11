/**
 * app.js
 * PPG解析アプリケーションのメインスクリプト（修正版）
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
    
    // 高度な解析の更新タイマー
    let advancedAnalysisTimer = null;
    
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
            
            // 高度な解析を開始
            if (advancedAnalysisTimer) {
                clearInterval(advancedAnalysisTimer);
            }
            advancedAnalysisTimer = setInterval(updateAdvancedGraphs, 1000);
            
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
        
        // 高度な解析を停止
        if (advancedAnalysisTimer) {
            clearInterval(advancedAnalysisTimer);
            advancedAnalysisTimer = null;
        }
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
    
    // LF/HF/LFiA/HFiAグラフを更新（修正版）
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
        
        // デバッグ情報を常に更新
        let lfia = 0;
        let hfia = 0;
        
        if (processor.lfiaBuffer && processor.lfiaBuffer.length > 0) {
            lfia = processor.lfiaBuffer[processor.lfiaBuffer.length - 1];
        }
        
        if (processor.hfiaBuffer && processor.hfiaBuffer.length > 0) {
            hfia = processor.hfiaBuffer[processor.hfiaBuffer.length - 1];
        }
        
        // 値が実際に数値であることを確認してから表示
        if (isFinite(lfia) && !isNaN(lfia)) {
            lfiaValueElement.textContent = lfia.toFixed(2);
        } else {
            // 有効な値が得られない場合は、初期値を設定
            lfiaValueElement.textContent = "30.00";
        }
        
        if (isFinite(hfia) && !isNaN(hfia)) {
            hfiaValueElement.textContent = hfia.toFixed(2);
        } else {
            // 有効な値が得られない場合は、初期値を設定
            hfiaValueElement.textContent = "25.00";
        }
        
        // 散布図を更新
        // 有効な値でなくても散布図を更新
        try {
            updateScatterPlot(
                processor.lfiaBuffer && processor.lfiaBuffer.length > 0 ? processor.lfiaBuffer : [30],
                processor.hfiaBuffer && processor.hfiaBuffer.length > 0 ? processor.hfiaBuffer : [25]
            );
            
            // ストレス状態の説明を更新
            updateStressState(
                isFinite(lfia) && !isNaN(lfia) ? lfia : 30,
                isFinite(hfia) && !isNaN(hfia) ? hfia : 25
            );
        } catch (error) {
            console.error("散布図の更新中にエラーが発生しました:", error);
        }
    }
    
    // 周波数帯域グラフを更新（改良版）
    function updateFrequencyGraph(graphElement, data, className) {
        if (!data || data.length === 0) return;
        
        // グラフをクリア
        graphElement.innerHTML = '';
        
        // データの有効性を確認
        const validData = data.filter(val => isFinite(val) && !isNaN(val));
        if (validData.length === 0) return;
        
        // データ範囲を計算（0より小さい値も適切に処理）
        let min = Math.min(...validData);
        let max = Math.max(...validData);
        
        // 範囲が小さすぎる場合は調整
        if (max - min < 0.001) {
            max = min + 1;
        }
        
        const range = max - min;
        
        // 表示するデータポイントの数を制限（最大30ポイント）
        const displayData = validData.length > 30 ? 
                        validData.slice(-30) : validData;
        
        // グラフを描画（バーチャート）
        displayData.forEach((value, index) => {
            // 無効な値はスキップ
            if (!isFinite(value) || isNaN(value)) return;
            
            const bar = document.createElement('div');
            bar.className = className;
            
            // 位置を計算（データが一つしかない場合の分母0を防止）
            const position = displayData.length > 1 ? 
                            (index / (displayData.length - 1)) * 100 : 50;
            bar.style.left = `${position}%`;
            
            // 値の正規化と高さの設定（負の値も適切に処理）
            const normalizedHeight = ((value - min) / range) * 100;
            bar.style.height = `${Math.max(1, Math.min(100, normalizedHeight))}%`;
            
            // ツールチップを追加（値を表示）
            bar.title = value.toFixed(2);
            
            graphElement.appendChild(bar);
        });
    }
    
    // ストレス状態の説明を更新する関数
    function updateStressState(lfia, hfia) {
        // ストレス状態の説明要素が存在しない場合は作成
        let stressStateElement = document.getElementById('stress-state');
        if (!stressStateElement) {
            stressStateElement = document.createElement('div');
            stressStateElement.id = 'stress-state';
            stressStateElement.className = 'stress-state-display';
            document.querySelector('.quadrant-legend').after(stressStateElement);
        }
        
        // 中心点
        const centerHF = 25;
        const centerLF = 30;
        
        // 状態の判定
        let stateText = '';
        let stateClass = '';
        
        if (lfia < centerLF && hfia < centerHF) {
            stateText = '安静状態 (Rest)';
            stateClass = 'state-rest';
        } else if (lfia >= centerLF && hfia < centerHF) {
            stateText = '軽い身体的ストレス (Light Physical Stress)';
            stateClass = 'state-physical';
        } else if (lfia < centerLF && hfia >= centerHF) {
            stateText = '深いリラックス状態 (Deep Relaxation)';
            stateClass = 'state-relaxation';
        } else {
            stateText = '軽い精神的ストレス (Light Mental Stress)';
            stateClass = 'state-mental';
        }
        
        // 表示を更新
        stressStateElement.textContent = `現在の状態: ${stateText}`;
        stressStateElement.className = 'stress-state-display ' + stateClass;
    }
    
    // 散布図を更新
    function updateScatterPlot(lfiaData, hfiaData) {
        if (!lfiaData || !hfiaData || lfiaData.length === 0 || hfiaData.length === 0) return;
        
        // グラフをクリア
        scatterGraph.innerHTML = '';
        
        // グリッド線と軸を描画
        drawScatterGrids();
        
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
        
        // 論文のように固定範囲を使用
        const hfiaMin = 0;
        const hfiaMax = 50;  // 論文に合わせて0-50の範囲
        const lfiaMin = 0;
        const lfiaMax = 60;  // 論文に合わせて0-60の範囲
        
        // 象限の中心点
        const centerHF = 25;  // HFの中心点
        const centerLF = 30;  // LFの中心点
        
        // ポイントを描画
        displayPoints.forEach((point, i) => {
            const { lfia, hfia } = point;
            
            // 範囲を指定の値に収める
            const clampedHF = Math.max(hfiaMin, Math.min(hfiaMax, hfia));
            const clampedLF = Math.max(lfiaMin, Math.min(lfiaMax, lfia));
            
            // 位置を計算（0-100%の範囲に正規化）
            const x = ((clampedHF - hfiaMin) / (hfiaMax - hfiaMin)) * 100;
            const y = ((clampedLF - lfiaMin) / (lfiaMax - lfiaMin)) * 100;
            
            // 範囲内にあることを確認
            if (x >= 0 && x <= 100 && y >= 0 && y <= 100) {
                const pointElement = document.createElement('div');
                pointElement.className = 'scatter-point';
                
                // 象限に基づいて色を決定（論文の図7に基づく）
                if (clampedHF < centerHF && clampedLF < centerLF) {
                    // 第3象限（左下）- 安静状態
                    pointElement.style.backgroundColor = '#3f51b5'; // 青
                } else if (clampedHF >= centerHF && clampedLF < centerLF) {
                    // 第4象限（右下）- 深いリラックス状態
                    pointElement.style.backgroundColor = '#4CAF50'; // 緑
                } else if (clampedHF < centerHF && clampedLF >= centerLF) {
                    // 第2象限（左上）- 軽い身体的ストレス
                    pointElement.style.backgroundColor = '#ff9800'; // オレンジ
                } else {
                    // 第1象限（右上）- 軽い精神的ストレス
                    pointElement.style.backgroundColor = '#f44336'; // 赤
                }
                
                pointElement.style.left = `${x}%`;
                pointElement.style.bottom = `${y}%`;
                
                // 最新のポイントは大きく表示
                if (i === displayPoints.length - 1) {
                    pointElement.style.width = '8px';
                    pointElement.style.height = '8px';
                    pointElement.style.transform = 'translate(-4px, 4px)';
                }
                
                scatterGraph.appendChild(pointElement);
            }
        });
    }

    // 散布図のグリッドラインと軸を描画
    function drawScatterGrids() {
        // 中心線（横）
        const horizontalCenter = document.createElement('div');
        horizontalCenter.className = 'scatter-grid-line horizontal';
        horizontalCenter.style.bottom = '50%';
        scatterGraph.appendChild(horizontalCenter);
        
        // 中心線（縦）
        const verticalCenter = document.createElement('div');
        verticalCenter.className = 'scatter-grid-line vertical';
        verticalCenter.style.left = '50%';
        scatterGraph.appendChild(verticalCenter);
        
        // X軸ラベル（HF）
        const xAxisLabel = document.createElement('div');
        xAxisLabel.className = 'scatter-axis-label x-axis';
        xAxisLabel.textContent = 'HF (0-50)';
        scatterGraph.appendChild(xAxisLabel);
        
        // Y軸ラベル（LF）
        const yAxisLabel = document.createElement('div');
        yAxisLabel.className = 'scatter-axis-label y-axis';
        yAxisLabel.textContent = 'LF (0-60)';
        scatterGraph.appendChild(yAxisLabel);
        
        // 中心点値のラベル
        const centerLabel = document.createElement('div');
        centerLabel.className = 'scatter-center-label';
        centerLabel.textContent = '(25,30)';
        centerLabel.style.left = '50%';
        centerLabel.style.bottom = '50%';
        scatterGraph.appendChild(centerLabel);
        
        // 象限ラベル（論文の図7に基づく）
        const q1Label = document.createElement('div');
        q1Label.className = 'quadrant-label q1';
        q1Label.textContent = '軽い精神的ストレス';
        q1Label.style.right = '25%';
        q1Label.style.top = '25%';
        scatterGraph.appendChild(q1Label);
        
        const q2Label = document.createElement('div');
        q2Label.className = 'quadrant-label q2';
        q2Label.textContent = '軽い身体的ストレス';
        q2Label.style.left = '25%';
        q2Label.style.top = '25%';
        scatterGraph.appendChild(q2Label);
        
        const q3Label = document.createElement('div');
        q3Label.className = 'quadrant-label q3';
        q3Label.textContent = '安静状態';
        q3Label.style.left = '25%';
        q3Label.style.bottom = '25%';
        scatterGraph.appendChild(q3Label);
        
        const q4Label = document.createElement('div');
        q4Label.className = 'quadrant-label q4';
        q4Label.textContent = '深いリラックス';
        q4Label.style.right = '25%';
        q4Label.style.bottom = '25%';
        scatterGraph.appendChild(q4Label);
    }

    // 設定パネルの初期化
    function initializeSettingsPanel() {
        // DOM要素の取得
        const toggleSettingsBtn = document.getElementById('toggle-settings');
        const settingsPanel = document.getElementById('settings-panel');
        const applySettingsBtn = document.getElementById('apply-settings');
        const resetSettingsBtn = document.getElementById('reset-settings');
        
        // スライダー要素
        const envelopeWindowSlider = document.getElementById('envelope-window');
        const smoothingWindowSlider = document.getElementById('smoothing-window');
        const averagingWindowSlider = document.getElementById('averaging-window');
        const peakThresholdSlider = document.getElementById('peak-threshold');
        const minPeakDistanceSlider = document.getElementById('min-peak-distance');
        
        // 値表示要素
        const envelopeWindowValue = document.getElementById('envelope-window-value');
        const smoothingWindowValue = document.getElementById('smoothing-window-value');
        const averagingWindowValue = document.getElementById('averaging-window-value');
        const peakThresholdValue = document.getElementById('peak-threshold-value');
        const minPeakDistanceValue = document.getElementById('min-peak-distance-value');
        
        // パネルの表示/非表示
        toggleSettingsBtn.addEventListener('click', function() {
            if (settingsPanel.style.display === 'none') {
                settingsPanel.style.display = 'block';
                toggleSettingsBtn.textContent = '設定を隠す';
            } else {
                settingsPanel.style.display = 'none';
                toggleSettingsBtn.textContent = '設定を表示';
            }
        });
        
        // スライダー値の表示更新
        envelopeWindowSlider.addEventListener('input', function() {
            envelopeWindowValue.textContent = this.value;
        });
        
        smoothingWindowSlider.addEventListener('input', function() {
            smoothingWindowValue.textContent = this.value;
        });
        
        averagingWindowSlider.addEventListener('input', function() {
            averagingWindowValue.textContent = this.value;
        });
        
        peakThresholdSlider.addEventListener('input', function() {
            peakThresholdValue.textContent = this.value;
        });
        
        minPeakDistanceSlider.addEventListener('input', function() {
            minPeakDistanceValue.textContent = this.value;
        });
        
        // 設定を適用
        applySettingsBtn.addEventListener('click', function() {
            // シグナルプロセッサの設定を更新
            if (cameraProcessor && cameraProcessor.signalProcessor) {
                const processor = cameraProcessor.signalProcessor;
                
                // 瞬時振幅計算の設定を更新
                processor.ENVELOPE_WINDOW_SIZE = parseInt(envelopeWindowSlider.value);
                processor.SMOOTHING_WINDOW_SIZE = parseInt(smoothingWindowSlider.value);
                processor.AVERAGING_WINDOW_SIZE = parseInt(averagingWindowSlider.value);
                
                // カメラプロセッサの設定を更新
                cameraProcessor.MIN_PEAK_DISTANCE_MS = parseInt(minPeakDistanceSlider.value);
                cameraProcessor.PEAK_THRESHOLD_PERCENT = parseInt(peakThresholdSlider.value);
                
                // 設定を適用したことを通知
                showNotification("設定を適用しました");
            }
        });
        
        // 設定をリセット
        resetSettingsBtn.addEventListener('click', function() {
            // スライダーをデフォルト値に戻す
            envelopeWindowSlider.value = 15;
            smoothingWindowSlider.value = 10;
            averagingWindowSlider.value = 20;
            peakThresholdSlider.value = 50;
            minPeakDistanceSlider.value = 250;
            
            // 表示値も更新
            envelopeWindowValue.textContent = "15";
            smoothingWindowValue.textContent = "10";
            averagingWindowValue.textContent = "20";
            peakThresholdValue.textContent = "50";
            minPeakDistanceValue.textContent = "250";
            
            // 設定を適用
            applySettingsBtn.click();
        });
    }

    // 通知を表示する関数
    function showNotification(message) {
        // 既存の通知を削除
        const existingNotification = document.querySelector('.notification');
        if (existingNotification) {
            existingNotification.remove();
        }
        
        // 新しい通知を作成
        const notification = document.createElement('div');
        notification.className = 'notification';
        notification.textContent = message;
        
        // スタイル設定
        notification.style.position = 'fixed';
        notification.style.bottom = '20px';
        notification.style.right = '20px';
        notification.style.backgroundColor = '#4CAF50';
        notification.style.color = 'white';
        notification.style.padding = '10px 20px';
        notification.style.borderRadius = '4px';
        notification.style.boxShadow = '0 2px 5px rgba(0,0,0,0.2)';
        notification.style.zIndex = '1000';
        notification.style.opacity = '0';
        notification.style.transition = 'opacity 0.3s ease';
        
        // ドキュメントに追加
        document.body.appendChild(notification);
        
        // フェードイン
        setTimeout(() => {
            notification.style.opacity = '1';
        }, 10);
        
        // 3秒後に消去
        setTimeout(() => {
            notification.style.opacity = '0';
            setTimeout(() => {
                notification.remove();
            }, 300);
        }, 3000);
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
    
    // 初期化
    getDevices();
    initializeSettingsPanel();
});