/**
 * signal-processing.js
 * 信号処理関連の機能を提供するモジュール
 */

class SignalProcessor {
    constructor() {
        // 定数
        this.SAMPLE_RATE = 30; // サンプルレート (Hz)
        this.LF_MIN = 0.04;    // LF帯域の下限 (Hz)
        this.LF_MAX = 0.15;    // LF帯域の上限 (Hz)
        this.HF_MIN = 0.15;    // HF帯域の下限 (Hz)
        this.HF_MAX = 0.4;     // HF帯域の上限 (Hz)
        this.MAX_WINDOW_SIZE = 300; // 最大ウィンドウサイズ (サンプル数)
        
        // バッファ
        this.ppgBuffer = [];     // PPG信号バッファ
        this.timeBuffer = [];    // タイムスタンプバッファ
        this.lfBuffer = [];      // LF成分バッファ
        this.hfBuffer = [];      // HF成分バッファ
        this.lfiaBuffer = [];    // LFiA (LF瞬時振幅) バッファ
        this.hfiaBuffer = [];    // HFiA (HF瞬時振幅) バッファ
        
        // フィルタ係数を計算
        this.lfFilter = this.createBandpassFilter(this.LF_MIN, this.LF_MAX, this.SAMPLE_RATE);
        this.hfFilter = this.createBandpassFilter(this.HF_MIN, this.HF_MAX, this.SAMPLE_RATE);
    }
    
    /**
     * データを追加して処理
     * @param {number} ppgValue - PPG値
     * @param {number} timestamp - タイムスタンプ
     * @returns {Object} 解析結果
     */
    addDataPoint(ppgValue, timestamp) {
        // バッファにデータを追加
        this.ppgBuffer.push(ppgValue);
        this.timeBuffer.push(timestamp);
        
        // バッファサイズを制限
        if (this.ppgBuffer.length > this.MAX_WINDOW_SIZE) {
            this.ppgBuffer.shift();
            this.timeBuffer.shift();
        }
        
        // バッファが十分なサイズになったら処理
        if (this.ppgBuffer.length >= 30) { // 最低1秒分のデータ
            // LFとHFに帯域分割
            const filtered = this.filterPPG();
            
            // 瞬時振幅を計算
            this.calculateInstantaneousAmplitude();
            
            // 結果を返す
            return {
                ppg: this.ppgBuffer,
                time: this.timeBuffer,
                lf: this.lfBuffer,
                hf: this.hfBuffer,
                lfia: this.lfiaBuffer,
                hfia: this.hfiaBuffer,
                currentLFiA: this.lfiaBuffer.length > 0 ? this.lfiaBuffer[this.lfiaBuffer.length - 1] : 0,
                currentHFiA: this.hfiaBuffer.length > 0 ? this.hfiaBuffer[this.hfiaBuffer.length - 1] : 0
            };
        }
        
        return {
            ppg: this.ppgBuffer,
            time: this.timeBuffer,
            lf: [],
            hf: [],
            lfia: [],
            hfia: [],
            currentLFiA: 0,
            currentHFiA: 0
        };
    }
    
    /**
     * PPG信号をLFとHF帯域に分離するフィルタリング
     * @returns {Object} フィルタリング結果
     */
    filterPPG() {
        // 入力信号のコピーを作成
        const inputSignal = [...this.ppgBuffer];
        
        // 平均値を計算
        const mean = inputSignal.reduce((sum, val) => sum + val, 0) / inputSignal.length;
        
        // 平均値を引いて0中心にする
        const centeredSignal = inputSignal.map(val => val - mean);
        
        // トレンド除去（オプション）
        const detrended = this.detrendSignal(centeredSignal);
        
        // LFバンドパスフィルタを適用
        this.lfBuffer = this.filterSignal(detrended, this.lfFilter);
        
        // HFバンドパスフィルタを適用
        this.hfBuffer = this.filterSignal(detrended, this.hfFilter);
        
        return {
            lf: this.lfBuffer,
            hf: this.hfBuffer
        };
    }
    
    /**
     * トレンド除去（線形トレンドを除去）
     * @param {Array} signal - 入力信号
     * @returns {Array} トレンド除去後の信号
     */
    detrendSignal(signal) {
        const n = signal.length;
        if (n < 3) return [...signal];
        
        // 線形最小二乗法によるトレンド検出
        let sumX = 0;
        let sumY = 0;
        let sumXY = 0;
        let sumX2 = 0;
        
        for (let i = 0; i < n; i++) {
            sumX += i;
            sumY += signal[i];
            sumXY += i * signal[i];
            sumX2 += i * i;
        }
        
        const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
        const intercept = (sumY - slope * sumX) / n;
        
        // トレンドを除去
        return signal.map((val, i) => val - (slope * i + intercept));
    }
    
    /**
     * 新しいバンドパスフィルタを作成（IIRフィルタ）
     * @param {number} lowCutoff - 低域カットオフ周波数 (Hz)
     * @param {number} highCutoff - 高域カットオフ周波数 (Hz)
     * @param {number} sampleRate - サンプルレート (Hz)
     * @returns {Object} フィルタオブジェクト
     */
    createBandpassFilter(lowCutoff, highCutoff, sampleRate) {
        // 正規化周波数に変換
        const nyquist = sampleRate / 2;
        const lowFreq = lowCutoff / nyquist;
        const highFreq = highCutoff / nyquist;
        
        // バンドパスフィルタ（2次のバターワース）
        const order = 2;
        
        // 低域フィルタ係数
        const wc1 = Math.tan(Math.PI * lowFreq);
        const k1 = Math.sqrt(2) * wc1;
        const v1 = wc1 * wc1;
        
        const b_low = [wc1 * wc1, 2 * wc1 * wc1, wc1 * wc1];
        const a_low = [1 + k1 + v1, 2 * (v1 - 1), 1 - k1 + v1];
        
        // 高域フィルタ係数
        const wc2 = Math.tan(Math.PI * highFreq);
        const k2 = Math.sqrt(2) * wc2;
        const v2 = wc2 * wc2;
        
        const b_high = [1, -2, 1];
        const a_high = [1 + k2 + v2, 2 * (v2 - 1), 1 - k2 + v2];
        
        // ステートを初期化
        const x_state_low = new Array(3).fill(0);
        const y_state_low = new Array(2).fill(0);
        const x_state_high = new Array(3).fill(0);
        const y_state_high = new Array(2).fill(0);
        
        return {
            b_low, a_low, b_high, a_high,
            x_state_low, y_state_low, x_state_high, y_state_high
        };
    }
    
    /**
     * バンドパスフィルタを信号に適用
     * @param {Array} signal - 入力信号
     * @param {Object} filter - フィルタオブジェクト
     * @returns {Array} フィルタリングされた信号
     */
    filterSignal(signal, filter) {
        const n = signal.length;
        const output = new Array(n);
        
        // 低域フィルタ適用
        const intermediate = new Array(n);
        for (let i = 0; i < n; i++) {
            // 入力をシフト
            filter.x_state_low[2] = filter.x_state_low[1];
            filter.x_state_low[1] = filter.x_state_low[0];
            filter.x_state_low[0] = signal[i];
            
            // フィルタを適用
            let y = filter.b_low[0] * filter.x_state_low[0] +
                    filter.b_low[1] * filter.x_state_low[1] +
                    filter.b_low[2] * filter.x_state_low[2] -
                    filter.a_low[1] * filter.y_state_low[0] -
                    filter.a_low[2] * filter.y_state_low[1];
            
            y /= filter.a_low[0];
            
            // 出力をシフト
            filter.y_state_low[1] = filter.y_state_low[0];
            filter.y_state_low[0] = y;
            
            intermediate[i] = y;
        }
        
        // 高域フィルタ適用
        for (let i = 0; i < n; i++) {
            // 入力をシフト
            filter.x_state_high[2] = filter.x_state_high[1];
            filter.x_state_high[1] = filter.x_state_high[0];
            filter.x_state_high[0] = intermediate[i];
            
            // フィルタを適用
            let y = filter.b_high[0] * filter.x_state_high[0] +
                    filter.b_high[1] * filter.x_state_high[1] +
                    filter.b_high[2] * filter.x_state_high[2] -
                    filter.a_high[1] * filter.y_state_high[0] -
                    filter.a_high[2] * filter.y_state_high[1];
            
            y /= filter.a_high[0];
            
            // 出力をシフト
            filter.y_state_high[1] = filter.y_state_high[0];
            filter.y_state_high[0] = y;
            
            output[i] = y;
        }
        
        return output;
    }
    
    /**
     * 瞬時振幅を計算（改良版ヒルベルト変換）
     */
    calculateInstantaneousAmplitude() {
        if (this.lfBuffer.length < 30 || this.hfBuffer.length < 30) {
            return;
        }
        
        // LFの瞬時振幅を計算（包絡線検出法使用）
        this.lfiaBuffer = this.calculateEnvelope(this.lfBuffer);
        
        // HFの瞬時振幅を計算（包絡線検出法使用）
        this.hfiaBuffer = this.calculateEnvelope(this.hfBuffer);
        
        // スケーリングと正規化
        this.normalizeAmplitudes();
    }
    
    /**
     * 包絡線検出による振幅計算（ヒルベルト変換の代替法）
     * @param {Array} signal - 入力信号
     * @returns {Array} 瞬時振幅
     */
    calculateEnvelope(signal) {
        const n = signal.length;
        const envelope = new Array(n);
        
        // ピーク検出による包絡線計算
        const windowSize = Math.min(5, Math.floor(n / 4));
        
        for (let i = 0; i < n; i++) {
            let maxVal = Math.abs(signal[i]);
            
            // 周囲のウィンドウでの最大値を探す
            for (let j = Math.max(0, i - windowSize); j <= Math.min(n - 1, i + windowSize); j++) {
                const absVal = Math.abs(signal[j]);
                if (absVal > maxVal) {
                    maxVal = absVal;
                }
            }
            
            envelope[i] = maxVal;
        }
        
        // 平滑化
        return this.smoothSignal(envelope, 3);
    }
    
    /**
     * 振幅の正規化とスケーリング
     */
    normalizeAmplitudes() {
        if (this.lfiaBuffer.length === 0 || this.hfiaBuffer.length === 0) {
            return;
        }
        
        // LFiAの正規化
        const lfMax = Math.max(...this.lfiaBuffer);
        const lfMin = Math.min(...this.lfiaBuffer);
        const lfRange = lfMax - lfMin || 1;
        
        // HFiAの正規化
        const hfMax = Math.max(...this.hfiaBuffer);
        const hfMin = Math.min(...this.hfiaBuffer);
        const hfRange = hfMax - hfMin || 1;
        
        // スケーリング (0-100の範囲に)
        this.lfiaBuffer = this.lfiaBuffer.map(val => (
            ((val - lfMin) / lfRange) * 100
        ));
        
        this.hfiaBuffer = this.hfiaBuffer.map(val => (
            ((val - hfMin) / hfRange) * 100
        ));
        
        // 外れ値を除去
        this.removeOutliers();
    }
    
    /**
     * 外れ値を除去
     */
    removeOutliers() {
        // LFiAの外れ値除去
        const lfMedian = this.calculateMedian(this.lfiaBuffer);
        const lfMad = this.calculateMAD(this.lfiaBuffer, lfMedian);
        
        this.lfiaBuffer = this.lfiaBuffer.map(val => {
            // 3MAD以上離れていたら除外
            if (Math.abs(val - lfMedian) > 3 * lfMad) {
                return lfMedian;
            }
            return val;
        });
        
        // HFiAの外れ値除去
        const hfMedian = this.calculateMedian(this.hfiaBuffer);
        const hfMad = this.calculateMAD(this.hfiaBuffer, hfMedian);
        
        this.hfiaBuffer = this.hfiaBuffer.map(val => {
            // 3MAD以上離れていたら除外
            if (Math.abs(val - hfMedian) > 3 * hfMad) {
                return hfMedian;
            }
            return val;
        });
    }
    
    /**
     * 中央値を計算
     * @param {Array} data - 入力データ
     * @returns {number} 中央値
     */
    calculateMedian(data) {
        const sorted = [...data].sort((a, b) => a - b);
        const mid = Math.floor(sorted.length / 2);
        
        if (sorted.length % 2 === 0) {
            return (sorted[mid - 1] + sorted[mid]) / 2;
        } else {
            return sorted[mid];
        }
    }
    
    /**
     * 絶対偏差中央値（MAD）を計算
     * @param {Array} data - 入力データ
     * @param {number} median - 中央値
     * @returns {number} MAD
     */
    calculateMAD(data, median) {
        const deviations = data.map(val => Math.abs(val - median));
        return this.calculateMedian(deviations);
    }
    
    /**
     * 信号を平滑化
     * @param {Array} signal - 入力信号
     * @param {number} windowSize - ウィンドウサイズ
     * @returns {Array} 平滑化された信号
     */
    smoothSignal(signal, windowSize) {
        const n = signal.length;
        const smoothed = new Array(n);
        
        for (let i = 0; i < n; i++) {
            let sum = 0;
            let count = 0;
            
            for (let j = Math.max(0, i - Math.floor(windowSize / 2)); 
                 j <= Math.min(n - 1, i + Math.floor(windowSize / 2)); j++) {
                sum += signal[j];
                count++;
            }
            
            smoothed[i] = sum / count;
        }
        
        return smoothed;
    }
    
    /**
     * 移動平均フィルタを適用
     * @param {Array} data - 入力データ
     * @param {number} windowSize - ウィンドウサイズ
     * @returns {Array} 平滑化されたデータ
     */
    movingAverage(data, windowSize) {
        const result = [];
        for (let i = 0; i < data.length; i++) {
            let sum = 0;
            let count = 0;
            for (let j = Math.max(0, i - windowSize + 1); j <= i; j++) {
                sum += data[j];
                count++;
            }
            result.push(sum / count);
        }
        return result;
    }
    
    /**
     * バッファをクリア
     */
    clearBuffers() {
        this.ppgBuffer = [];
        this.timeBuffer = [];
        this.lfBuffer = [];
        this.hfBuffer = [];
        this.lfiaBuffer = [];
        this.hfiaBuffer = [];
        
        // フィルタステートもリセット
        this.lfFilter = this.createBandpassFilter(this.LF_MIN, this.LF_MAX, this.SAMPLE_RATE);
        this.hfFilter = this.createBandpassFilter(this.HF_MIN, this.HF_MAX, this.SAMPLE_RATE);
    }
}