/**
 * signal-processing.js
 * 信号処理関連の機能を提供するモジュール（簡易修正版）
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
        this.ENVELOPE_WINDOW_SIZE = 30;    // 瞬時振幅計算の時間窓サイズ (サンプル数)
        this.SMOOTHING_WINDOW_SIZE = 15;   // 振幅スムージングの窓サイズ (サンプル数)
        this.AVERAGING_WINDOW_SIZE = 30;   // 移動平均の窓サイズ (サンプル数)
        this.MAX_PPG_VALUE = 255;  // PPG信号の最大値（赤色成分のサチュレーション対策）

        // バッファ
        this.ppgBuffer = [];     // PPG信号バッファ
        this.timeBuffer = [];    // タイムスタンプバッファ
        this.lfBuffer = [];      // LF成分バッファ
        this.hfBuffer = [];      // HF成分バッファ
        this.lfiaBuffer = [];    // LFiA (LF瞬時振幅) バッファ
        this.hfiaBuffer = [];    // HFiA (HF瞬時振幅) バッファ
        
        // RRIデータ
        this.rriBuffer = [];     // RRI値バッファ
        this.rriTimeBuffer = []; // RRIタイムスタンプバッファ
        
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
        // サチュレーション対策：最大値でクリップ
        const clippedValue = Math.min(ppgValue, this.MAX_PPG_VALUE);
        
        // バッファにデータを追加
        this.ppgBuffer.push(clippedValue);
        this.timeBuffer.push(timestamp);
        
        // バッファサイズを制限
        if (this.ppgBuffer.length > this.MAX_WINDOW_SIZE) {
            this.ppgBuffer.shift();
            this.timeBuffer.shift();
        }
        
        // バッファが十分なサイズになったら処理
        if (this.ppgBuffer.length >= 30) { // 最低1秒分のデータ
            try {
                // LFとHFに帯域分割
                const filtered = this.filterPPG();
                
                // 瞬時振幅を計算
                this.calculateInstantaneousAmplitude();
            } catch (error) {
                console.error("信号処理中にエラーが発生しました:", error);
            }
            
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
        
        // トレンド除去（直線成分を除去）
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
        
        const denominator = (n * sumX2 - sumX * sumX);
        if (Math.abs(denominator) < 1e-10) {
            // 分母がほぼ0の場合は元の信号を返す
            return [...signal];
        }
        
        const slope = (n * sumXY - sumX * sumY) / denominator;
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
     * 包絡線検出による振幅計算（改良版：時間窓を可変に）
     * @param {Array} signal - 入力信号
     * @param {number} windowSize - ウィンドウサイズ（サンプル数）
     * @returns {Array} 瞬時振幅
     */
    calculateEnvelope(signal, windowSize = this.ENVELOPE_WINDOW_SIZE) {
        if (!signal || signal.length === 0) return [];
        
        const n = signal.length;
        const envelope = new Array(n);
        
        // 窓サイズを検証
        const actualWindowSize = Math.min(windowSize, Math.floor(n / 2));
        
        for (let i = 0; i < n; i++) {
            let maxVal = 0;
            let sum = 0;
            let count = 0;
            
            // 前後のウィンドウで振幅を計算
            const rawValues = [];
            for (let j = Math.max(0, i - actualWindowSize); j <= Math.min(n - 1, i + actualWindowSize); j++) {
                const absVal = Math.abs(signal[j]);
                if (isFinite(absVal) && !isNaN(absVal)) {
                    rawValues.push(absVal);
                    maxVal = Math.max(maxVal, absVal);
                }
            }
            
            // 平均絶対値と最大値の組み合わせ（より安定した振幅計算）
            let meanVal = 0;
            if (rawValues.length > 0) {
                // 計算した値を昇順にソート
                const sortedValues = [...rawValues].sort((a, b) => a - b);
                // 上位と下位各20%を除外
                const startIndex = Math.floor(sortedValues.length * 0.2);
                const endIndex = Math.floor(sortedValues.length * 0.8);
                const validValues = sortedValues.slice(startIndex, endIndex);
                // 平均値を計算
                meanVal = validValues.length > 0 ? 
                    validValues.reduce((sum, val) => sum + val, 0) / validValues.length : 0;
            }
            envelope[i] = 0.7 * maxVal + 0.3 * meanVal;  // 加重平均
        }
        
        // 平滑化
        return this.smoothSignal(envelope, this.SMOOTHING_WINDOW_SIZE);
    }

    /**
     * 瞬時振幅を計算（改良版）
     */
    calculateInstantaneousAmplitude() {
        if (this.lfBuffer.length < this.ENVELOPE_WINDOW_SIZE * 2 || 
            this.hfBuffer.length < this.ENVELOPE_WINDOW_SIZE * 2) {
            return;
        }
        
        try {
            // より安定した包絡線検出を使用
            const rawLfia = this.calculateEnvelope(this.lfBuffer, this.ENVELOPE_WINDOW_SIZE);
            const rawHfia = this.calculateEnvelope(this.hfBuffer, this.ENVELOPE_WINDOW_SIZE);
            
            // 振幅の移動平均（より安定性を向上）
            const smoothedLfia = this.calculateMovingAverage(rawLfia, this.AVERAGING_WINDOW_SIZE);
            const smoothedHfia = this.calculateMovingAverage(rawHfia, this.AVERAGING_WINDOW_SIZE);
            
            // バッファに追加
            this.lfiaBuffer = smoothedLfia;
            this.hfiaBuffer = smoothedHfia;
            
            // スケーリングと正規化
            this.normalizeAndScaleAmplitudes();
        } catch (error) {
            console.error("瞬時振幅計算中にエラーが発生しました:", error);
            
            // エラーが発生した場合でも何らかの値を設定（ダミー値を使用）
            if (this.lfiaBuffer.length === 0) {
                this.lfiaBuffer = [30]; // LFiAのダミー値
            }
            
            if (this.hfiaBuffer.length === 0) {
                this.hfiaBuffer = [25]; // HFiAのダミー値
            }
        }
    }

    /**
     * 移動平均を計算（長い時間窓用）
     * @param {Array} data - 入力データ
     * @param {number} windowSize - ウィンドウサイズ
     * @returns {Array} 移動平均後のデータ
     */
    calculateMovingAverage(data, windowSize) {
        if (!data || data.length === 0) return [];
        
        const n = data.length;
        const result = new Array(n);
        
        for (let i = 0; i < n; i++) {
            let sum = 0;
            let count = 0;
            
            // 中心を基準とした対称なウィンドウ
            const halfWindow = Math.floor(windowSize / 2);
            
            for (let j = Math.max(0, i - halfWindow); j <= Math.min(n - 1, i + halfWindow); j++) {
                if (isFinite(data[j]) && !isNaN(data[j])) {
                    // 距離に基づく重み付け（中心に近いほど重み大）
                    const weight = 1 - Math.abs(i - j) / (halfWindow + 1);
                    sum += data[j] * weight;
                    count += weight;
                }
            }
            
            result[i] = count > 0 ? sum / count : 0;
        }
        
        return result;
    }
    
    /**
     * 振幅の正規化とスケーリング（改良版）
     */
    normalizeAndScaleAmplitudes() {
        if (this.lfiaBuffer.length === 0 || this.hfiaBuffer.length === 0) {
            return;
        }

        try {
            // 急激な変化を防ぐために過去の値も考慮
            // 静的な参照値の導入
            const DEFAULT_LF_MIN = 0.1;
            const DEFAULT_LF_MAX = 2.0;
            const DEFAULT_HF_MIN = 0.05;
            const DEFAULT_HF_MAX = 1.5;

            // 最小値と最大値を静的な値から初期化（安定性のため）
            let lfMin = DEFAULT_LF_MIN;
            let lfMax = DEFAULT_LF_MAX;
            let hfMin = DEFAULT_HF_MIN;
            let hfMax = DEFAULT_HF_MAX;

            // 有効な値だけを考慮
            const validLfValues = [];
            const validHfValues = [];
            
            for (let i = 0; i < this.lfiaBuffer.length; i++) {
                const lfVal = this.lfiaBuffer[i];
                if (isFinite(lfVal) && !isNaN(lfVal) && lfVal > 0) {
                    validLfValues.push(lfVal);
                }
            }
            
            for (let i = 0; i < this.hfiaBuffer.length; i++) {
                const hfVal = this.hfiaBuffer[i];
                if (isFinite(hfVal) && !isNaN(hfVal) && hfVal > 0) {
                    validHfValues.push(hfVal);
                }
            }
            
            // 十分なデータがある場合のみ最小値と最大値を更新
            if (validLfValues.length > 5) {
                // 外れ値に影響されにくいように5-95パーセンタイルを使用
                validLfValues.sort((a, b) => a - b);
                const lowerIdx = Math.floor(validLfValues.length * 0.05);
                const upperIdx = Math.floor(validLfValues.length * 0.95);
                
                lfMin = validLfValues[lowerIdx];
                lfMax = validLfValues[upperIdx];
            }
            
            if (validHfValues.length > 5) {
                validHfValues.sort((a, b) => a - b);
                const lowerIdx = Math.floor(validHfValues.length * 0.05);
                const upperIdx = Math.floor(validHfValues.length * 0.95);
                
                hfMin = validHfValues[lowerIdx];
                hfMax = validHfValues[upperIdx];
            }
            
            // 範囲の確認と調整（最小幅を確保）
            if (lfMax - lfMin < 0.1) {
                const mid = (lfMax + lfMin) / 2;
                lfMin = mid - 0.05;
                lfMax = mid + 0.05;
            }
            
            if (hfMax - hfMin < 0.1) {
                const mid = (hfMax + hfMin) / 2;
                hfMin = mid - 0.05;
                hfMax = mid + 0.05;
            }
            
            // 安定化のために、値が大きく変動しないようにする
            // 前回の値との混合比率
            const ALPHA = 0.3; // 新しい値の重み（0-1）
            
            // クラス変数として前回の値を保持
            if (!this.prevLfMin) this.prevLfMin = lfMin;
            if (!this.prevLfMax) this.prevLfMax = lfMax;
            if (!this.prevHfMin) this.prevHfMin = hfMin;
            if (!this.prevHfMax) this.prevHfMax = hfMax;
            
            // 前回の値と現在の値の加重平均
            lfMin = this.prevLfMin * (1 - ALPHA) + lfMin * ALPHA;
            lfMax = this.prevLfMax * (1 - ALPHA) + lfMax * ALPHA;
            hfMin = this.prevHfMin * (1 - ALPHA) + hfMin * ALPHA;
            hfMax = this.prevHfMax * (1 - ALPHA) + hfMax * ALPHA;
            
            // 値を保存
            this.prevLfMin = lfMin;
            this.prevLfMax = lfMax;
            this.prevHfMin = hfMin;
            this.prevHfMax = hfMax;
            
            // スケーリング
            const scaledLfiaBuffer = new Array(this.lfiaBuffer.length);
            const scaledHfiaBuffer = new Array(this.hfiaBuffer.length);
            
            for (let i = 0; i < this.lfiaBuffer.length; i++) {
                const val = this.lfiaBuffer[i];
                if (isFinite(val) && !isNaN(val)) {
                    const normalized = (val - lfMin) / (lfMax - lfMin);
                    // 0-60の範囲にスケーリングし、値が範囲外の場合はクリップ
                    scaledLfiaBuffer[i] = Math.max(0, Math.min(60, normalized * 60));
                } else {
                    scaledLfiaBuffer[i] = 30; // デフォルト値
                }
            }
            
            for (let i = 0; i < this.hfiaBuffer.length; i++) {
                const val = this.hfiaBuffer[i];
                if (isFinite(val) && !isNaN(val)) {
                    const normalized = (val - hfMin) / (hfMax - hfMin);
                    // 0-50の範囲にスケーリングし、値が範囲外の場合はクリップ
                    scaledHfiaBuffer[i] = Math.max(0, Math.min(50, normalized * 50));
                } else {
                    scaledHfiaBuffer[i] = 25; // デフォルト値
                }
            }
            
            // バッファを更新
            this.lfiaBuffer = scaledLfiaBuffer;
            this.hfiaBuffer = scaledHfiaBuffer;
            
        } catch (error) {
            console.error("振幅の正規化中にエラーが発生しました:", error);
            // エラー時のフォールバック値
            this.lfiaBuffer = this.lfiaBuffer.map(() => 30);
            this.hfiaBuffer = this.hfiaBuffer.map(() => 25);
        }
    }
    
    /**
     * 中央値を計算
     * @param {Array} data - 入力データ
     * @returns {number} 中央値
     */
    calculateMedian(data) {
        if (data.length === 0) return 0;
        
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
        if (data.length === 0) return 0;
        
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
        if (signal.length === 0) return [];
        
        const n = signal.length;
        const smoothed = new Array(n);
        
        for (let i = 0; i < n; i++) {
            let sum = 0;
            let count = 0;
            
            for (let j = Math.max(0, i - Math.floor(windowSize / 2)); 
                 j <= Math.min(n - 1, i + Math.floor(windowSize / 2)); j++) {
                if (isFinite(signal[j]) && !isNaN(signal[j])) {
                    sum += signal[j];
                    count++;
                }
            }
            
            smoothed[i] = count > 0 ? sum / count : 0;
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
        if (data.length === 0) return [];
        
        const result = [];
        for (let i = 0; i < data.length; i++) {
            let sum = 0;
            let count = 0;
            for (let j = Math.max(0, i - windowSize + 1); j <= i; j++) {
                if (isFinite(data[j]) && !isNaN(data[j])) {
                    sum += data[j];
                    count++;
                }
            }
            result.push(count > 0 ? sum / count : 0);
        }
        return result;
    }
    
    /**
     * RRIデータを追加して処理
     * @param {number} rriValue - RRI値（ミリ秒）
     * @param {number} timestamp - タイムスタンプ
     */
    addRriData(rriValue, timestamp) {
        // バッファにデータを追加
        this.rriBuffer.push(rriValue);
        this.rriTimeBuffer.push(timestamp);
        
        // バッファサイズを制限（最大100個）
        if (this.rriBuffer.length > 100) {
            this.rriBuffer.shift();
            this.rriTimeBuffer.shift();
        }
        
        // RRIデータからHRVパラメータの再計算（十分なデータがある場合）
        if (this.rriBuffer.length >= 8) { // 最低8拍分
            this.calculateHRVFromRRI();
        }
    }
    
    /**
     * RRIデータからHRVパラメータを計算
     */
    calculateHRVFromRRI() {
        try {
            // RRIデータが十分あるか確認
            if (this.rriBuffer.length < 8) return;
            
            // RRIデータを使用して直接LFiA、HFiAを生成
            const rriMean = this.rriBuffer.reduce((sum, val) => sum + val, 0) / this.rriBuffer.length;
            
            // HRV指標を計算（SDNN、RMSSD）
            const sdnn = Math.sqrt(this.rriBuffer.reduce((sum, val) => sum + Math.pow(val - rriMean, 2), 0) / this.rriBuffer.length);
            
            let rmssd = 0;
            if (this.rriBuffer.length > 1) {
                let sumOfSquaredDiffs = 0;
                for (let i = 1; i < this.rriBuffer.length; i++) {
                    sumOfSquaredDiffs += Math.pow(this.rriBuffer[i] - this.rriBuffer[i-1], 2);
                }
                rmssd = Math.sqrt(sumOfSquaredDiffs / (this.rriBuffer.length - 1));
            }
            
            // RRIの変動からLFiA、HFiAを推定
            // SDNNはLFとHFの両方を反映、RMSSDは主にHFを反映
            
            // LFiA値を計算（SDNNに基づく）
            const newLFiA = Math.max(10, Math.min(60, sdnn / 3));
            this.lfiaBuffer.push(newLFiA);
            
            // HFiA値を計算（RMSSDに基づく）
            const newHFiA = Math.max(5, Math.min(50, rmssd / 5));
            this.hfiaBuffer.push(newHFiA);
            
            // バッファサイズを制限
            if (this.lfiaBuffer.length > this.MAX_WINDOW_SIZE) {
                this.lfiaBuffer.shift();
            }
            
            if (this.hfiaBuffer.length > this.MAX_WINDOW_SIZE) {
                this.hfiaBuffer.shift();
            }
        } catch (error) {
            console.error("RRIからのHRV計算中にエラーが発生しました:", error);
        }
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
        this.rriBuffer = [];
        this.rriTimeBuffer = [];
        
        // フィルタステートもリセット
        this.lfFilter = this.createBandpassFilter(this.LF_MIN, this.LF_MAX, this.SAMPLE_RATE);
        this.hfFilter = this.createBandpassFilter(this.HF_MIN, this.HF_MAX, this.SAMPLE_RATE);
    }
}