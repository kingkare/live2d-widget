/* global document, window, Event */

// ✅ 1. 引用全部改为小写，确保 Linux/Cloudflare 能找到文件
import { LAppDelegate } from '@demo/lappdelegate.js';
import * as LAppDefine from '@demo/lappdefine.js';
import { LAppModel } from '@demo/lappmodel.js';
import { LAppPal } from '@demo/lapppal.js';

// ✅ 2. 新增引入：因为没有 LAppSubdelegate 了，我们需要手动引入这些 Manager
import { LAppView } from '@demo/lappview.js';
import { LAppTextureManager } from '@demo/lapptexturemanager.js';
import { LAppLive2DManager } from '@demo/lapplive2dmanager.js';
import { LAppGlManager } from '@demo/lappglmanager.js';

import logger from '../logger.js';

LAppPal.printMessage = () => {};

// ✅ 3. 重写 AppSubdelegate：去掉 extends LAppSubdelegate
// 自定义子委托类，负责 Canvas 相关的初始化和渲染管理
class AppSubdelegate {
  constructor() {
    // 手动初始化核心管理器
    this._glManager = new LAppGlManager();
    this._textureManager = new LAppTextureManager();
    this._view = new LAppView();
    this._live2dManager = LAppLive2DManager.getInstance();
    
    this._canvas = null;
    this._frameBuffer = null;
    this._resizeObserver = null;
    this._needResize = false;
  }

  /**
   * 初始化应用所需的资源
   * @param {HTMLCanvasElement} canvas 传入的 canvas 对象
   */
  initialize(canvas) {
    // 初始化 WebGL 管理器，失败则返回 false
    if (!this._glManager.initialize(canvas)) {
      return false;
    }

    this._canvas = canvas;

    // Canvas 尺寸设置，支持 auto 和指定大小
    if (LAppDefine.CanvasSize === 'auto') {
      this.resizeCanvas();
    } else {
      canvas.width = LAppDefine.CanvasSize.width;
      canvas.height = LAppDefine.CanvasSize.height;
    }

    // 为纹理管理器设置 GL 管理器
    this._textureManager.setGlManager(this._glManager);

    const gl = this._glManager.getGl();

    // 如果帧缓冲区对象未初始化，获取当前的帧缓冲区绑定
    if (!this._frameBuffer) {
      this._frameBuffer = gl.getParameter(gl.FRAMEBUFFER_BINDING);
    }

    // 启用混合模式以支持透明度
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    // 初始化视图 (AppView)
    this._view.initialize(); // 注意：v5 SDK通常不需要传参数，或者逻辑已变更
    this._view.setImages(this._textureManager); // 确保关联纹理管理器

    // 关联 Live2D 管理器
    this._live2dManager.setDelegate(this); // 如果支持的话，或者忽略

    // 监听 canvas 尺寸变化以进行响应式适配
    this._resizeObserver = new window.ResizeObserver(
      (entries) => {
        // 简化回调逻辑
        this._needResize = true;
      }
    );
    this._resizeObserver.observe(this._canvas);

    return true;
  }

  /**
   * 手动实现 resizeCanvas (因为没有父类了)
   */
  resizeCanvas() {
    if (!this._canvas) return;
    // 这里简单的将 canvas 尺寸设为视窗大小，或者根据需求调整
    const width = this._canvas.clientWidth;
    const height = this._canvas.clientHeight;
    
    // 只有当尺寸真正改变时才重新赋值，避免闪烁
    if (this._canvas.width !== width || this._canvas.height !== height) {
      this._canvas.width = width;
      this._canvas.height = height;
      // 通知 GL Manager 尺寸改变
      if(this._view) {
        // 重新初始化 view 的尺寸比例
        const ratio = width / height;
        const left = -ratio;
        const right = ratio;
        const bottom = -1.0;
        const top = 1.0;
        this._view.setScreenRect(left, right, bottom, top); // 设置视图范围
        this._view.setMaxScreenRect(left, right, bottom, top);
      }
    }
  }

  /**
   * Canvas 尺寸变化时调整并重新初始化视图
   */
  onResize() {
    this.resizeCanvas();
    this._view.initialize();
    
    const gl = this._glManager.getGl();
    if(gl) {
        gl.viewport(0, 0, this._canvas.width, this._canvas.height);
    }
  }

  /**
   * 主渲染循环，周期性调用以更新屏幕
   */
  update() {
    const gl = this._glManager.getGl();
    
    // 检查 WebGL 上下文是否丢失
    if (!gl || gl.isContextLost()) {
      return;
    }

    // 如果需要调整大小，调用 onResize
    if (this._needResize) {
      this.onResize();
      this._needResize = false;
    }

    // 初始化 Canvas 为全透明
    gl.clearColor(0.0, 0.0, 0.0, 0.0);

    // 启用深度测试
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);

    // 清除颜色和深度缓冲
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.clearDepth(1.0);

    // 再次启用混合模式
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    // 渲染视图内容
    this._view.render();
  }

  // 辅助方法：获取内部管理器
  getLive2DManager() {
      return this._live2dManager;
  }
  
  getCanvas() {
      return this._canvas;
  }
  
  isContextLost() {
      const gl = this._glManager.getGl();
      return !gl || gl.isContextLost();
  }
}

// ✅ 4. AppDelegate 修改：使用原生 Array 替代 SDK Vector，防止类型错误
export class AppDelegate extends LAppDelegate {
  constructor() {
    super();
    this._subdelegates = []; // 使用原生数组
    this._canvases = [];     // 使用原生数组
    this._drawFrameId = null;
  }

  run() {
    const loop = () => {
      LAppPal.updateTime();

      // 使用原生数组遍历
      for (let i = 0; i < this._subdelegates.length; i++) {
        this._subdelegates[i].update();
      }

      this._drawFrameId = window.requestAnimationFrame(loop);
    };
    loop();
  }

  stop() {
    if (this._drawFrameId) {
      window.cancelAnimationFrame(this._drawFrameId);
      this._drawFrameId = null;
    }
  }

  release() {
    this.stop();
    this.releaseEventListener();
    // 清空数组
    this._subdelegates = []; 
    this._cubismOption = null;
  }

  transformOffset(e)
