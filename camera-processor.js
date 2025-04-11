/**
 * camera-processor.js
 * カメラ映像からPPG信号を抽出する機能を提供するモジュール
 */

class CameraProcessor {
    constructor() {
        // カメラ関連の要素
        this.videoElement = null;
        this.canvasElement = null;
        this.canvasContext = null;
        this.mediaStream = null;
        
        // 計測関連の状態
        this.isRecording = false;
        this.animationFrame = null;
        this.lastFrameTime = 0;
        this.frameCount = 0;
        this.frameRates = [];
        
        // PPG関連のデータ
        this.ppgData = [];
        this.timeValues = [];
        this.peaks = [];
        this.lastPeakTime = 0;
        this.rriData = [];
        
        // コールバック関数
        this.onPpgUpdate = null;
        this.onRriUpdate = null;
        this.onFrameRateUpdate = null;
        this.onPeakDetected = null;
        
        // 設定値
        this.MIN_PEAK_DISTANCE_MS = 250;  // 最小ピーク間距離（ミリ秒）240BPM相当
        this.RRI_MIN_MS = 300;            // 最小RRI（ミリ秒）200BPM相当
        this.RRI_MAX_MS = 1500;           // 最大RRI（ミリ秒）40BPM相当
        this.PEAK_WINDOW_SIZE = 10;       // ピーク検出ウィンドウサイズ
        this.MAX_PPG_SAMPLES = 100;       // 最大PPGサンプル数
        this.SAMPLE_RATE = 30;            // 推定サンプルレート（カメラのフレームレート

        // 信号処理
        this.signalProcessor = new SignalProcessor();
    }
    
    /**
     * 初期化
     * @param {HTMLVideoElement} videoElement - ビデオ要素
     * @param {HTMLCanvasElement} canvasElement - キャンバス要素
     */
    initialize(videoElement, canvasElement) {
        this.videoElement = videoElement;
        this.canvasElement = canvasElement;
        this.canvasContext = canvasElement.getContext('2d', { willReadFrequently: true });
    }
    
    /**
     * コールバック関数を設定
     * @param {Object} callbacks - コールバック関数オブジェクト
     */
    setCallbacks(callbacks) {
        this.onPpgUpdate = callbacks.onPpgUpdate || null;
        this.onRriUpdate = callbacks.onRriUpdate || null;
        this.onFrameRateUpdate = callbacks.onFrameRateUpdate || null;
        this.onPeakDetected = callbacks.onPeakDetected || null;
    }
    
    /**
     * カメラデバイスを取得
     * @returns {Promise<Array>} カメラデバイスの配列
     */
    async getDevices() {
        try {
            const devices = await navigator.mediaDevices.enumerateDevices();
            return devices.filter(device => device.kind === 'videoinput');
        } catch (err) {
            console.error('カメラデバイスの取得に失敗しました:', err);
            throw err;
        }
    }
    
    /**
     * カメラを起動
     * @param {string} deviceId - カメラデバイスID
     * @returns {Promise<boolean>} 成功したかどうか
     */
    async startCamera(deviceId) {
        try {
            // 既存のストリームを停止
            if (this.mediaStream) {
                this.mediaStream.getTracks().forEach(track => track.stop());
            }
            
            // カメラの制約を設定
            const constraints = {
                video: {
                    deviceId: deviceId ? { exact: deviceId } : undefined,
                    width: { ideal: 640 },
                    height: { ideal: 480 },
                    frameRate: { ideal: 30 }
                }
            };
            
            // カメラにアクセス
            const stream = await navigator.mediaDevices.getUserMedia(constraints);
            this.mediaStream = stream;
            
            // ビデオ要素に接続
            this.videoElement.srcObject = stream;
            await this.videoElement.play();
            
            // キャンバスのサイズを設定
            this.canvasElement.width = this.videoElement.videoWidth;
            this.canvasElement.height = this.videoElement.videoHeight;
            
            // カメラのライト（トーチ）をサポートしている場合は点灯
            try {
                const videoTrack = stream.getVideoTracks()[0];
                const capabilities = videoTrack.getCapabilities();
                
                // トーチ機能をサポートしているか確認
                if (capabilities.torch) {
                    // トーチを点灯
                    await videoTrack.applyConstraints({
                        advanced: [{ torch: true }]
                    });
                    console.log('カメラライトを点灯しました');
                } else {
                    console.log('このデバイスはカメラライト機能をサポートしていません');
                }
            } catch (err) {
                console.log('カメラライトの制御中にエラーが発生しました:', err);
                // ライトの制御に失敗してもカメラ機能自体は継続
            }
            
            return true;
        } catch (err) {
            console.error('カメラの起動に失敗しました:', err);
            return false;
        }
    }
    
    /**
     * 録画開始
     * @returns {Promise<boolean>} 成功したかどうか
     */
    async startRecording() {
        // データをリセット
        this.ppgData = [];
        this.timeValues = [];
        this.peaks = [];
        this.lastPeakTime = 0;
        this.rriData = [];
        this.frameCount = 0;
        this.lastFrameTime = performance.now();
        this.frameRates = [];
        this.signalProcessor.clearBuffers();
        
        this.isRecording = true;
        
        // フレーム処理を開始
        this.processFrame();
        
        return true;
    }
    
    /**
     * 録画停止
     */
    stopRecording() {
        this.isRecording = false;
        
        // アニメーションフレームをキャンセル
        if (this.animationFrame) {
            cancelAnimationFrame(this.animationFrame);
            this.animationFrame = null;
        }
        
        // メディアストリームを停止
        if (this.mediaStream) {
            this.mediaStream.getTracks().forEach(track => track.stop());
            this.mediaStream = null;
        }
    }
    
    /**
     * PPG信号の前処理を強化するメソッド
     * @param {Array} rawPpgData - 生のPPGデータ
     * @returns {Array} 前処理済みのPPGデータ
     */
    preprocessPpgSignal(rawPpgData) {
        if (rawPpgData.length < 3) return [...rawPpgData];
        
        // ステップ1: 移動平均フィルタで高周波ノイズを除去
        let filteredPpg = this.signalProcessor.movingAverage(rawPpgData, 5);
        
        // ステップ2: トレンド除去（信号プロセッサのメソッドを利用）
        const mean = filteredPpg.reduce((sum, val) => sum + val, 0) / filteredPpg.length;
        const centeredSignal = filteredPpg.map(val => val - mean);
        filteredPpg = this.signalProcessor.detrendSignal(centeredSignal);
        
        // ステップ3: 外れ値の除去（中央値絶対偏差法）
        const median = this.signalProcessor.calculateMedian(filteredPpg);
        const mad = this.signalProcessor.calculateMAD(filteredPpg, median);
        const threshold = 3.0; // 閾値（通常は2.5-3.5）
        
        filteredPpg = filteredPpg.map(val => {
            const z = Math.abs(val - median) / (mad || 1);
            return z > threshold ? median : val;
        });
        
        // ステップ4: 再度スムージング
        filteredPpg = this.signalProcessor.movingAverage(filteredPpg, 3);
        
        return filteredPpg;
    }

    /**
     * フレームレートを計算
     */
    calculateFrameRate() {
        const now = performance.now();
        const elapsed = now - this.lastFrameTime;
        this.frameCount++;
        
        // 1秒ごとにフレームレートを更新
        if (elapsed >= 1000) {
            const currentFps = Math.round((this.frameCount * 1000) / elapsed);
            this.frameRates.push(currentFps);
            
            // 直近5つの値の平均を表示
            if (this.frameRates.length > 5) {
                this.frameRates.shift();
            }
            
            const avgFps = Math.round(this.frameRates.reduce((sum, val) => sum + val, 0) / this.frameRates.length);
            
            if (this.onFrameRateUpdate) {
                this.onFrameRateUpdate(avgFps);
            }
            
            this.frameCount = 0;
            this.lastFrameTime = now;
        }
    }
    
    /**
     * フレーム処理
     */
    processFrame() {
        if (!this.isRecording) return;
        
        // フレームレートを計算
        this.calculateFrameRate();
        
        // ビデオフレームをキャンバスに描画
        this.canvasContext.drawImage(this.videoElement, 0, 0, this.canvasElement.width, this.canvasElement.height);
        
        // ピクセルデータを取得
        const frame = this.canvasContext.getImageData(0, 0, this.canvasElement.width, this.canvasElement.height);
        const data = frame.data;
        const length = data.length;
        
        // 指の検出（赤要素が強い領域のみを分析）
        let validPixelCount = 0;
        let redSum = 0;
        
        // 指の検出のための閾値
        const RED_THRESHOLD = 100;
        const RED_DOMINANCE = 1.2; // 赤が他のチャンネルより20%以上強い
        
        for (let i = 0; i < length; i += 4) {
            const r = data[i];     // 赤
            const g = data[i + 1]; // 緑
            const b = data[i + 2]; // 青
            
            // 指の組織を検出（赤が強く、他の色よりも優勢）
            if (r > RED_THRESHOLD && r > g * RED_DOMINANCE && r > b * RED_DOMINANCE) {
                redSum += r;
                validPixelCount++;
            }
        }
        
        const timestamp = Date.now();
        
        // 有効なピクセルが十分にある場合のみ処理
        if (validPixelCount > 100) {
            const redAvg = redSum / validPixelCount;
            
            // PPGデータを保存
            this.ppgData.push(redAvg);
            this.timeValues.push(timestamp);
            
            // 最新のMAX_PPG_SAMPLESサンプルだけを保持
            if (this.ppgData.length > this.MAX_PPG_SAMPLES) {
                this.ppgData.shift();
                this.timeValues.shift();
            }
            
            // 信号の前処理（新しく追加したメソッド）
            if (this.ppgData.length > 10) {
                const processedPpg = this.preprocessPpgSignal([...this.ppgData]);
                
                // PPGデータをコールバックで通知
                if (this.onPpgUpdate) {
                    this.onPpgUpdate(processedPpg, this.timeValues);
                }
                
                // 信号処理を実行
                this.signalProcessor.addDataPoint(redAvg, timestamp);
                
                // ピーク検出（改良したアルゴリズム）
                this.detectPeaks();
            }
        } else {
            // 有効なピクセルが少なすぎる場合（指が検出されていない）
            console.log("指が検出されていません。カメラに指を近づけてください。");
        }
        
        // 次のフレームを処理
        this.animationFrame = requestAnimationFrame(() => this.processFrame());
    }
    
    /**
     * ピーク検出処理（改良版）
     */
    detectPeaks() {
        // 少なくともPEAK_WINDOW_SIZE+1サンプルが必要
        if (this.ppgData.length > this.PEAK_WINDOW_SIZE) {
            // 移動平均を適用して信号をスムーズにする - 窓サイズを大きくして5に
            const smoothedPpg = this.signalProcessor.movingAverage(this.ppgData, 5);
            
            // 現在の点がピークかどうか検出
            const currentIndex = smoothedPpg.length - this.PEAK_WINDOW_SIZE;
            if (currentIndex > 0) {
                const currentPoint = smoothedPpg[currentIndex];
                
                // ピークかどうかチェック（ローカル最大値）
                let isPeak = true;
                for (let i = 1; i <= this.PEAK_WINDOW_SIZE / 2; i++) {
                    // 前後の点と比較
                    if (currentPoint <= smoothedPpg[currentIndex - i] || 
                        currentPoint <= smoothedPpg[currentIndex + i]) {
                        isPeak = false;
                        break;
                    }
                }
                
                // 振幅の閾値を確認（ノイズ除去のため）
                if (isPeak) {
                    // 過去30秒のデータから振幅の閾値を計算
                    const recentPpg = smoothedPpg.slice(-Math.min(smoothedPpg.length, 30 * this.SAMPLE_RATE));
                    const min = Math.min(...recentPpg);
                    const max = Math.max(...recentPpg);
                    // 閾値を50%に引き上げ（より明確なピークのみを検出）
                    const threshold = min + (max - min) * 0.5;
                    
                    // 閾値未満のピークは無視
                    if (currentPoint < threshold) {
                        isPeak = false;
                    }
                }
                
                // 前回のピークから一定時間経過しているか確認
                const currentTime = this.timeValues[currentIndex];
                const timeSinceLastPeak = currentTime - this.lastPeakTime;
                
                // 最小ピーク間隔を240BPMに基づいて設定（60000 / 240 = 250ms）
                const MIN_PEAK_INTERVAL_MS = 250;
                
                if (isPeak && timeSinceLastPeak > MIN_PEAK_INTERVAL_MS) {
                    // ピークを検出
                    this.peaks.push(currentTime);
                    this.lastPeakTime = currentTime;
                    
                    // ピーク検出をコールバックで通知
                    if (this.onPeakDetected) {
                        this.onPeakDetected(this.peaks.length);
                    }
                    
                    // RRIを計算（2つ以上のピークがある場合）
                    if (this.peaks.length > 1) {
                        const newRri = this.peaks[this.peaks.length - 1] - this.peaks[this.peaks.length - 2];
                        
                        // RRIが妥当な範囲内か確認（40BPM-200BPMの範囲に制限）
                        const RRI_MIN_MS = 300;  // 200BPM相当
                        const RRI_MAX_MS = 1500; // 40BPM相当
                        
                        if (newRri >= RRI_MIN_MS && newRri <= RRI_MAX_MS) {
                            this.rriData.push(newRri);
                            
                            // RRIデータをシグナルプロセッサに渡してHRV解析の精度を上げる
                            this.signalProcessor.addRriData(newRri, currentTime);
                            
                            // RRIデータをコールバックで通知
                            if (this.onRriUpdate) {
                                this.onRriUpdate(this.rriData);
                            }
                        }
                    }
                }
            }
        }
    }
}