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
        this.MIN_PEAK_DISTANCE_MS = 300;  // 最小ピーク間距離（ミリ秒）
        this.RRI_MIN_MS = 600;            // 最小RRI（ミリ秒）
        this.RRI_MAX_MS = 1200;           // 最大RRI（ミリ秒）
        this.PEAK_WINDOW_SIZE = 10;       // ピーク検出ウィンドウサイズ
        this.MAX_PPG_SAMPLES = 100;       // 最大PPGサンプル数
        
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
        
        // 赤チャンネルの平均値を計算（指の透過光を分析）
        let redSum = 0;
        for (let i = 0; i < length; i += 4) {
            redSum += data[i]; // 赤チャンネル
        }
        
        const redAvg = redSum / (length / 4);
        const timestamp = Date.now();
        
        // PPGデータを保存
        this.ppgData.push(redAvg);
        this.timeValues.push(timestamp);
        
        // 最新のMAX_PPG_SAMPLESサンプルだけを保持
        if (this.ppgData.length > this.MAX_PPG_SAMPLES) {
            this.ppgData.shift();
            this.timeValues.shift();
        }
        
        // PPGデータをコールバックで通知
        if (this.onPpgUpdate) {
            this.onPpgUpdate(this.ppgData, this.timeValues);
        }
        
        // 信号処理を実行
        const processingResult = this.signalProcessor.addDataPoint(redAvg, timestamp);
        
        // ピーク検出（アルゴリズム1の実装）
        this.detectPeaks();
        
        // 次のフレームを処理
        this.animationFrame = requestAnimationFrame(() => this.processFrame());
    }
    
    /**
     * ピーク検出処理
     */
    detectPeaks() {
        // 少なくともPEAK_WINDOW_SIZE+1サンプルが必要
        if (this.ppgData.length > this.PEAK_WINDOW_SIZE) {
            // 移動平均を適用して信号をスムーズにする
            const smoothedPpg = this.signalProcessor.movingAverage(this.ppgData, 3);
            
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
                
                // 前回のピークから一定時間経過しているか確認
                const currentTime = this.timeValues[currentIndex];
                const timeSinceLastPeak = currentTime - this.lastPeakTime;
                
                if (isPeak && timeSinceLastPeak > this.MIN_PEAK_DISTANCE_MS) {
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
                        
                        // RRIが妥当な範囲内か確認
                        if (newRri >= this.RRI_MIN_MS && newRri <= this.RRI_MAX_MS) {
                            this.rriData.push(newRri);
                            
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