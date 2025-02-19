window.CESIUM_BASE_URL = "./ThirdParty/Cesium/";

let CesiumViewer;
let gaussianSplatPrimitive;
let gsPrimitive;
let vertexCount = 0;
let splatTexData, splatTexWidth, splatTexHeight;
let viewProj;
let worker;
function createWorker(self) {
  let buffer;
  let vertexCount = 0;
  let viewProj;
  // 6*4 + 4 + 4 = 8*4
  // XYZ - Position (Float32)
  // XYZ - Scale (Float32)
  // RGBA - colors (uint8)
  // IJKL - quaternion/rot (uint8)
  const rowLength = 3 * 4 + 3 * 4 + 4 + 4;
  let lastProj = [];
  let depthIndex = new Uint32Array();
  let lastVertexCount = 0;

  let _floatView = new Float32Array(1);
  let _int32View = new Int32Array(_floatView.buffer);

  let floatView = new Float32Array(1);
  let int32View = new Int32Array(floatView.buffer);
  function floatToHalf(float) {
    floatView[0] = float;
    let f = int32View[0];

    let sign = (f >> 31) & 0x0001;
    let exp = (f >> 23) & 0x00ff;
    let frac = f & 0x007fffff;

    let newExp;
    if (exp == 0) {
      newExp = 0;
    } else if (exp < 113) {
      newExp = 0;
      frac |= 0x00800000;
      frac = frac >> (113 - exp);
      if (frac & 0x01000000) {
        newExp = 1;
        frac = 0;
      }
    } else if (exp < 142) {
      newExp = exp - 112;
    } else {
      newExp = 31;
      frac = 0;
    }

    return (sign << 15) | (newExp << 10) | (frac >> 13);
  }

  function packHalf2x16(x, y) {
    return (floatToHalf(x) | (floatToHalf(y) << 16)) >>> 0;
  }

  function generateTexture(buffer, vertexCount) {
    if (!buffer) return;

    const f_buffer = new Float32Array(buffer);
    const u_buffer = new Uint8Array(buffer);

    let texwidth = 1024 * 2; // Set to your desired width
    let texheight = Math.ceil((2 * vertexCount) / texwidth); // Set to your desired height

    let texdata = new Uint32Array(texwidth * texheight * 4); // 4 components per pixel (RGBA)
    let texdata_c = new Uint8Array(texdata.buffer);
    let texdata_f = new Float32Array(texdata.buffer);

    // Here we convert from a .splat file buffer into a texture
    // With a little bit more foresight perhaps this texture file
    // should have been the native format as it'd be very easy to
    // load it into webgl.
    for (let i = 0; i < vertexCount; i++) {
      // x, y, z
      texdata_f[8 * i + 0] = f_buffer[8 * i + 0];
      texdata_f[8 * i + 1] = f_buffer[8 * i + 1];
      texdata_f[8 * i + 2] = f_buffer[8 * i + 2];

      /* console.log(
      "XYZ",
      texdata_f[8 * i + 0],
      texdata_f[8 * i + 1],
      texdata_f[8 * i + 2],
    ); */

      // r, g, b, a
      texdata_c[4 * (8 * i + 7) + 0] = u_buffer[32 * i + 24 + 0];
      texdata_c[4 * (8 * i + 7) + 1] = u_buffer[32 * i + 24 + 1];
      texdata_c[4 * (8 * i + 7) + 2] = u_buffer[32 * i + 24 + 2];
      texdata_c[4 * (8 * i + 7) + 3] = u_buffer[32 * i + 24 + 3];

      // quaternions
      let scale = [
        f_buffer[8 * i + 3 + 0],
        f_buffer[8 * i + 3 + 1],
        f_buffer[8 * i + 3 + 2],
      ];

      let rot = [
        (u_buffer[32 * i + 28 + 0] - 128) / 128,
        (u_buffer[32 * i + 28 + 1] - 128) / 128,
        (u_buffer[32 * i + 28 + 2] - 128) / 128,
        (u_buffer[32 * i + 28 + 3] - 128) / 128,
      ];

      // Compute the matrix product of S and R (M = S * R)
      const M = [
        1.0 - 2.0 * (rot[2] * rot[2] + rot[3] * rot[3]),
        2.0 * (rot[1] * rot[2] + rot[0] * rot[3]),
        2.0 * (rot[1] * rot[3] - rot[0] * rot[2]),

        2.0 * (rot[1] * rot[2] - rot[0] * rot[3]),
        1.0 - 2.0 * (rot[1] * rot[1] + rot[3] * rot[3]),
        2.0 * (rot[2] * rot[3] + rot[0] * rot[1]),

        2.0 * (rot[1] * rot[3] + rot[0] * rot[2]),
        2.0 * (rot[2] * rot[3] - rot[0] * rot[1]),
        1.0 - 2.0 * (rot[1] * rot[1] + rot[2] * rot[2]),
      ].map((k, i) => k * scale[Math.floor(i / 3)]);

      const sigma = [
        M[0] * M[0] + M[3] * M[3] + M[6] * M[6],
        M[0] * M[1] + M[3] * M[4] + M[6] * M[7],
        M[0] * M[2] + M[3] * M[5] + M[6] * M[8],
        M[1] * M[1] + M[4] * M[4] + M[7] * M[7],
        M[1] * M[2] + M[4] * M[5] + M[7] * M[8],
        M[2] * M[2] + M[5] * M[5] + M[8] * M[8],
      ];

      texdata[8 * i + 4] = packHalf2x16(4 * sigma[0], 4 * sigma[1]);
      texdata[8 * i + 5] = packHalf2x16(4 * sigma[2], 4 * sigma[3]);
      texdata[8 * i + 6] = packHalf2x16(4 * sigma[4], 4 * sigma[5]);
    }
    self.postMessage({ texdata, texwidth, texheight }, [texdata.buffer]);
  }

  /**
   * 对顶点进行排序，并发送包含深度索引、视图投影矩阵和顶点数量的消息到主线程
   *
   * @param {Float32Array} viewProj - 视图投影矩阵
   */
  function runSort(viewProj) {
    // 检查buffer是否存在
    if (!buffer) return;

    // 将buffer转换为Float32Array
    const f_buffer = new Float32Array(buffer);

    // 如果顶点数量没有变化，则检查投影矩阵是否接近单位矩阵
    if (lastVertexCount == vertexCount) {
      let dot =
        lastProj[2] * viewProj[2] +
        lastProj[6] * viewProj[6] +
        lastProj[10] * viewProj[10];
      if (Math.abs(dot - 1) < 0.01) {
        // 如果投影矩阵接近单位矩阵，则直接返回
        return;
      }
    } else {
      // 如果顶点数量发生变化，则重新生成纹理
      generateTexture(buffer, vertexCount);
      lastVertexCount = vertexCount;
    }

    // 开始计时
    console.time("sort");

    // 初始化最大深度、最小深度和顶点大小列表
    let maxDepth = -Infinity;
    let minDepth = Infinity;
    let sizeList = new Int32Array(vertexCount);

    // 遍历顶点，计算深度并更新最大深度和最小深度
    for (let i = 0; i < vertexCount; i++) {
      let depth =
        ((viewProj[2] * f_buffer[8 * i + 0] +
          viewProj[6] * f_buffer[8 * i + 1] +
          viewProj[10] * f_buffer[8 * i + 2]) *
          4096) |
        0;
      sizeList[i] = depth;
      if (depth > maxDepth) maxDepth = depth;
      if (depth < minDepth) minDepth = depth;
    }
    // 单次通过计数排序（16位）
    // 计算深度倒数
    let depthInv = (256 * 256) / (maxDepth - minDepth);
    // 初始化计数数组
    let counts0 = new Uint32Array(256 * 256);
    // 遍历顶点，计算索引并更新计数数组
    for (let i = 0; i < vertexCount; i++) {
      sizeList[i] = ((sizeList[i] - minDepth) * depthInv) | 0;
      counts0[sizeList[i]]++;
    }
    // 初始化起始位置数组
    let starts0 = new Uint32Array(256 * 256);
    // 计算起始位置
    for (let i = 1; i < 256 * 256; i++)
      starts0[i] = starts0[i - 1] + counts0[i - 1];
    // 初始化深度索引数组
    depthIndex = new Uint32Array(vertexCount);
    // 遍历顶点，根据计数数组和起始位置数组更新深度索引数组
    for (let i = 0; i < vertexCount; i++)
      depthIndex[starts0[sizeList[i]]++] = i;
    // 结束计时
    console.timeEnd("sort");
    // 更新最后使用的投影矩阵
    lastProj = viewProj;
    // 发送消息到主线程，包含深度索引、视图投影矩阵和顶点数量
    self.postMessage({ depthIndex, viewProj, vertexCount }, [
      depthIndex.buffer,
    ]);
  }

  const throttledSort = () => {
    if (!sortRunning) {
      sortRunning = true;
      let lastView = viewProj;
      runSort(lastView);
      setTimeout(() => {
        sortRunning = false;
        if (lastView !== viewProj) {
          throttledSort();
        }
      }, 0);
    }
  };

  let sortRunning;
  self.onmessage = (e) => {
    if (e.data.ply) {
      vertexCount = 0;
      runSort(viewProj);
      postMessage({ buffer: buffer });
    } else if (e.data.buffer) {
      buffer = e.data.buffer;
      vertexCount = e.data.vertexCount;
    } else if (e.data.vertexCount) {
      vertexCount = e.data.vertexCount;
    } else if (e.data.view) {
      viewProj = e.data.view;
      throttledSort();
    }
  };
}

let lastFrame = 0;
const frame = (now) => {
  if (!CesiumViewer) return;
  let webglContext = CesiumViewer.scene.context;
  let modelView = webglContext.uniformState.modelView;
  worker.postMessage({ view: modelView });
  lastFrame = now;
  requestAnimationFrame(frame);
};

main();

async function main() {
  let carousel = true;
  const params = new URLSearchParams(location.search);
  try {
    viewMatrix = JSON.parse(decodeURIComponent(location.hash.slice(1)));
    carousel = false;
  } catch (err) {}
  const url = new URL(
    // "nike.splat",
    // location.href,
    params.get("url") || "train.splat",
    "https://huggingface.co/cakewalk/splat-data/resolve/main/"
  );
  const req = await fetch(url, {
    mode: "cors", // no-cors, *cors, same-origin
    credentials: "omit", // include, *same-origin, omit
  });
  console.log("req", req);
  if (req.status != 200)
    throw new Error(req.status + " Unable to load " + req.url);

  const rowLength = 3 * 4 + 3 * 4 + 4 + 4;
  const reader = req.body.getReader();
  let splatData = new Uint8Array(req.headers.get("content-length"));
  console.log("splatData", splatData);

  const downsample =
    splatData.length / rowLength > 500000 ? 1 : 1 / devicePixelRatio;
  console.log(splatData.length / rowLength, downsample);

  //创建Worker
  worker = new Worker(
    URL.createObjectURL(
      new Blob(["(", createWorker.toString(), ")(self)"], {
        type: "application/javascript",
      })
    )
  );

  //接收消息
  worker.onmessage = (e) => {
    console.log("worker.onmessage", e.data);

    if (e.data.buffer) {
      splatData = new Uint8Array(e.data.buffer);
      const blob = new Blob([splatData.buffer], {
        type: "application/octet-stream",
      });
      const link = document.createElement("a");
      link.download = "model.splat";
      link.href = URL.createObjectURL(blob);
      document.body.appendChild(link);
      link.click();
    } else if (e.data.texdata) {
      //绑定纹理数据
      const { texdata, texwidth, texheight } = e.data;

      const data = {
        vertexCount: splatData.length / rowLength,
        buffer: splatData,
        texdata: texdata,
        texwidth: texwidth,
        texheight: texheight,
      };

      SetupCustomSplatDrawer(data);

      //  updateSplatTexture(texdata);
    } else if (e.data.depthIndex) {
      const { depthIndex, viewProj } = e.data;
      //绑定index数据
      vertexCount = e.data.vertexCount;
      // updateSplatIndex(depthIndex);
    }
  };

  //创建Viewer
  initViewer();

  //设置SplatViewer
  const data = {
    vertexCount: splatData.length / rowLength,
    buffer: splatData,
    texdata: splatTexData,
    texwidth: splatTexWidth,
    texheight: splatTexHeight,
  };

  let bytesRead = 0;
  let lastVertexCount = -1;
  let stopLoading = false;
  //worker发送消息
  while (true) {
    const { done, value } = await reader.read();
    if (done || stopLoading) break;

    splatData.set(value, bytesRead);
    bytesRead += value.length;
    vertexCount = Math.floor(bytesRead / rowLength);

    if (vertexCount > lastVertexCount) {
      worker.postMessage({
        buffer: splatData.buffer,
        vertexCount: Math.floor(bytesRead / rowLength),
      });
      lastVertexCount = vertexCount;
    }
  }

  worker.onerror = function (e) {
    console.log("worker.onerror", e);
  };

  function initViewer() {
    CesiumViewer = new Cesium.Viewer("cesiumContainer", {
      baseLayerPicker: false,
      baseLayer: Cesium.ImageryLayer.fromProviderAsync(
        Cesium.TileMapServiceImageryProvider.fromUrl(
          Cesium.buildModuleUrl("Assets/Textures/NaturalEarthII")
        )
      ),
      geocoder: false,
      timeline: false,
      animation: false,
      homeButton: false,
      fullscreenButton: false,
      selectionIndicator: false,
      infoBox: false,
      useDefaultRenderLoop: true,
      orderIndependentTranslucency: true,
      scene3DOnly: true,
      automaticallyTrackDataSourceClocks: false,
      dataSources: null,
      clock: null,
      targetFrameRate: 60,
      resolutionScale: 0.1,
      terrainShadows: Cesium.ShadowMode.ENABLED,
      navigationHelpButton: false,
      contextOptions: {
        // requestWebgl2: true, // for a one day upgrade test
        webgl: {
          alpha: false,
          antialias: true,
          preserveDrawingBuffer: true,
          failIfMajorPerformanceCaveat: false,
          depth: false,
          stencil: true,
        },
      },
    });

    let utc = Cesium.JulianDate.fromDate(new Date("2025/02/06 04:00:00")); //UTC
    CesiumViewer.clockViewModel.currentTime = Cesium.JulianDate.addHours(
      utc,
      8,
      new Cesium.JulianDate()
    );

    frame();
  }

  // abstract primitive to hook into render pipe
  class GaussianSplatPrimitive {
    constructor(options) {
      this.vertexArray = options.vertexArray;
      this.uniformMap = options.uniformMap;
      this.vertexShaderSource = options.vertexShaderSource;
      this.fragmentShaderSource = options.fragmentShaderSource;
      this.renderState = options.renderState;
      this.modelMatrix = options.modelMatrix;
      this.instanceCount = options.instanceCount;
      //this.framebuffer = options.framebuffer;
      this.show = true;
      this.commandToExecute = undefined;
    }

    createCommand(context) {
      let shaderProgram = Cesium.ShaderProgram.fromCache({
        context: context,
        attributeLocations: this.vertexArray.attributes,
        vertexShaderSource: this.vertexShaderSource,
        fragmentShaderSource: this.fragmentShaderSource,
        debugShaders: true,
        logShaderCompilation: true,
      });

      console.log("shaderProgram", shaderProgram);

      let cachedRenderState = Cesium.RenderState.fromCache(this.renderState);
      //console.log("instance count:", this.instanceCount);
      return new Cesium.DrawCommand({
        owner: this,
        vertexArray: this.vertexArray,
        primitiveType: Cesium.PrimitiveType.TRIANGLE_FAN, //Cesium.PrimitiveType.TRIANGLE,////origial
        uniformMap: this.uniformMap,
        modelMatrix: this.modelMatrix,
        instanceCount: this.instanceCount,
        shaderProgram: shaderProgram,
        //framebuffer: this.framebuffer,
        renderState: cachedRenderState,
        pass: Cesium.Pass.TRANSLUCENT,
        //pass: Cesium.Pass.OPAQUE
      });
    }

    update(frameState) {
      if (!this.show) {
        return;
      }
      if (!Cesium.defined(this.commandToExecute)) {
        this.commandToExecute = this.createCommand(frameState.context);
      }
      frameState.commandList.push(this.commandToExecute);
    }

    isDestroyed() {
      return false;
    }

    destroy() {
      if (Cesium.defined(this.commandToExecute)) {
        this.commandToExecute.shaderProgram =
          this.commandToExecute.shaderProgram &&
          this.commandToExecute.shaderProgram.destroy();
      }
      return Cesium.destroyObject(this);
    }
  }

  let GSplatDrawer = null;

  function updateSplatIndex(depthIndex) {
    if (!gsPrimitive) return;
    gsPrimitive.vertexArray._attributes[1].vertexBuffer._buffer.typedArray =
      depthIndex;
    let frameState = CesiumViewer.scene.frameState;
    if (!frameState) return;
    gsPrimitive.update(frameState);
  }

  function updateSplatTexture(texdata) {
    if (!gsPrimitive) return;
    if (!gsPrimitive.commandToExecute) return;
    gsPrimitive.commandToExecute._uniformMap.u_texture = texdata;

    let frameState = CesiumViewer.scene.frameState;
    if (!frameState) return;
    gsPrimitive.update(frameState);
  }

  function computeModelMatrix() {
    const center = Cesium.Cartesian3.fromDegrees(
      120,
      30,
      10,
      CesiumViewer.scene.globe.ellipsoid
    );
    let modelMatrix = Cesium.Transforms.eastNorthUpToFixedFrame(center);

    const translationMatrix = Cesium.Matrix4.fromTranslation(
      Cesium.Cartesian3.fromArray([60, 100, 0.0])
    );

    modelMatrix = Cesium.Matrix4.multiply(
      modelMatrix,
      translationMatrix,
      new Cesium.Matrix4()
    );

    const rotationMatrix = Cesium.Matrix4.fromRotationTranslation(
      Cesium.Matrix3.fromRotationX(Cesium.Math.toRadians(-90))
    );

    modelMatrix = Cesium.Matrix4.multiply(
      modelMatrix,
      rotationMatrix,
      new Cesium.Matrix4()
    );

    const scaleMatrix = Cesium.Matrix4.fromScale(
      new Cesium.Cartesian3(6.0, 6.0, 6.0)
    );

    modelMatrix = Cesium.Matrix4.multiply(
      modelMatrix,
      scaleMatrix,
      new Cesium.Matrix4()
    );

    return modelMatrix;
  }

  function SetupCustomSplatDrawer(data) {
    //  if (GSplatDrawer != null) return;
    if (GSplatDrawer != null) {
      if (gaussianSplatPrimitive != null) {
        CesiumViewer.scene.primitives.remove(gaussianSplatPrimitive);
      }
    }

    let InWebGLContext = CesiumViewer.scene.context;

    let InPointCount = data.vertexCount;
    let buffer = data.buffer;
    let texdata = data.texdata;
    let splatTexWidth = data.texwidth;
    let splatTexHeight = data.texheight;

    if (!buffer) {
      console.log("buffer is null");
      return;
    }

    try {
      let vertexShaderSource = `
			#version 300 es
			precision highp float;
			precision highp int;
						
      uniform highp usampler2D u_texture; 
			
			uniform vec2 focal;

			in vec2 position;
			in int index; 

			out vec4 vColor;
			out vec2 vPosition;

			void main () {
        uvec4 cen = texelFetch(u_texture, ivec2((uint(index) & 0x3ffu) << 1, uint(index) >> 10), 0);
				
				vec4 cam = czm_modelView * vec4(uintBitsToFloat(cen.xyz), 1);
				vec4 pos2d = czm_projection * cam;    

				float clip = 1.2 * pos2d.w;
				if (pos2d.z < -clip || pos2d.x < -clip || pos2d.x > clip || pos2d.y < -clip || pos2d.y > clip) {
					gl_Position = vec4(0.0, 0.0, 2.0, 1.0);
					return;
				}

        uvec4 cov = texelFetch(u_texture, ivec2(((uint(index) & 0x3ffu) << 1) | 1u, uint(index) >> 10), 0);
				vec2 u1 = unpackHalf2x16(cov.x), u2 = unpackHalf2x16(cov.y), u3 = unpackHalf2x16(cov.z);
				mat3 Vrk = mat3(u1.x, u1.y, u2.x, u1.y, u2.y, u3.x, u2.x, u3.x, u3.y);

				mat3 J = mat3(
					focal.x / cam.z, 0., -(focal.x * cam.x) / (cam.z * cam.z), 
					0., -focal.y / cam.z, (focal.y * cam.y) / (cam.z * cam.z), 
					0., 0., 0.
				);

				mat3 T = transpose(mat3(czm_modelView)) * J;
				mat3 cov2d = transpose(T) * Vrk * T;

				float mid = (cov2d[0][0] + cov2d[1][1]) / 2.0;
				float radius = length(vec2((cov2d[0][0] - cov2d[1][1]) / 2.0, cov2d[0][1]));

				float lambda1 = mid + radius, lambda2 = mid - radius;

				if(lambda2 < 0.0) return;
				vec2 diagonalVector = normalize(vec2(cov2d[0][1], lambda1 - cov2d[0][0]));
				vec2 majorAxis = min(sqrt(2.0 * lambda1), 1024.0) * diagonalVector;
				vec2 minorAxis = min(sqrt(2.0 * lambda2), 1024.0) * vec2(diagonalVector.y, -diagonalVector.x);

				vColor = clamp(pos2d.z/pos2d.w+1.0, 0.0, 1.0) * vec4((cov.w) & 0xffu, (cov.w >> 8) & 0xffu, (cov.w >> 16) & 0xffu, (cov.w >> 24) & 0xffu) / 255.0;
				vPosition = position;

				vec2 vCenter = vec2(pos2d) / pos2d.w;
				gl_Position =  vec4(
					vCenter 
					+ position.x * majorAxis / czm_viewport.zw 
					+ position.y * minorAxis / czm_viewport.zw, 0.0, 1.0);

			}
		`.trim();

      let fragmentShaderSource = `
			#version 300 es
			precision highp float;

			in vec4 vColor;
			in vec2 vPosition;

			void main () {
				float A = -dot(vPosition, vPosition);
				if (A < -4.0) discard;
				float B = exp(A) * vColor.a;
				 out_FragColor = vec4(B * vColor.rgb, B);
       // out_FragColor = vec4(B * vColor.rgb, 0.2);
			}

		`.trim();

      let splatRenderState = {
        blending: {
          enabled: true,
          equationRgb: Cesium.BlendEquation.ADD,
          equationAlpha: Cesium.BlendEquation.ADD,
          functionSourceRgb: Cesium.BlendFunction.ONE_MINUS_DST_ALPHA,
          functionSourceAlpha: Cesium.BlendFunction.ONE_MINUS_DST_ALPHA,
          functionDestinationRgb: Cesium.BlendFunction.ONE,
          functionDestinationAlpha: Cesium.BlendFunction.ONE,
        },
        depthTest: {
          enabled: false,
        },
        depthMask: false,
        cull: {
          enabled: false,
          face: Cesium.CullFace.FRONT,
        },
      };

      let vertexSource = new Cesium.ShaderSource({
        sources: [vertexShaderSource],
      });

      let fragmentSource = new Cesium.ShaderSource({
        sources: [fragmentShaderSource],
      });

      // const triangleVertices = new Float32Array([-2, -2, 2, -2, 2, 2, -2, 2]);
      const triangleVertices = new Float32Array([-1, -1, 1, -1, 1, 1, -1, 1]);

      const triBuffer = Cesium.Buffer.createVertexBuffer({
        context: InWebGLContext,
        typedArray: triangleVertices,

        usage: Cesium.BufferUsage.STATIC_DRAW,
      });

      let cloudIndexPnts = new Uint32Array(InPointCount);
      for (let i = 0; i < cloudIndexPnts.length; i++) {
        cloudIndexPnts[i] = i;
      }

      const orderedSplatIndices = Cesium.Buffer.createVertexBuffer({
        context: InWebGLContext,
        // typedArray: depthIndex,
        typedArray: cloudIndexPnts,
        usage: Cesium.BufferUsage.DYNAMIC_DRAW,
      });

      const tempSplatTexture = new Cesium.Texture({
        context: InWebGLContext,
        width: splatTexWidth,
        height: splatTexHeight,
        pixelFormat: Cesium.PixelFormat.RGBA_INTEGER,
        pixelDatatype: Cesium.PixelDatatype.UNSIGNED_INT,
        source: {
          width: splatTexWidth,
          height: splatTexHeight,
          arrayBufferView: texdata,
        },
        flipY: false,
        sampler: new Cesium.Sampler({
          wrapS: Cesium.TextureWrap.CLAMP_TO_EDGE,
          wrapT: Cesium.TextureWrap.CLAMP_TO_EDGE,
          minificationFilter: Cesium.TextureMinificationFilter.NEAREST,
          magnificationFilter: Cesium.TextureMagnificationFilter.NEAREST,
        }),
      });

      let uniformMap = {
        u_texture: function () {
          return tempSplatTexture;
        },
        focal: function () {
          return new Cesium.Cartesian2(1000, 1000);
        },
      };

      const attributes = [
        {
          index: 0,
          enabled: true,
          vertexBuffer: triBuffer,
          componentsPerAttribute: 2,
          componentDatatype: Cesium.ComponentDatatype.FLOAT,
          normalize: false,
          offsetInBytes: 0,
          strideInBytes: 0,
          instanceDivisor: 0,
        },
        {
          index: 1,
          enabled: true,
          vertexBuffer: orderedSplatIndices,
          componentsPerAttribute: 1,
          componentDatatype: Cesium.ComponentDatatype.INT,
          normalize: false,
          offsetInBytes: 0,
          strideInBytes: 0,
          bindAsInteger: true,
          instanceDivisor: 1,
        },
      ];

      const splatsVertexArray = new Cesium.VertexArray({
        context: InWebGLContext,
        attributes: attributes,
      });

      let modelMatrix = computeModelMatrix();

      gaussianSplatPrimitive = new GaussianSplatPrimitive({
        vertexArray: splatsVertexArray,
        uniformMap: uniformMap,
        modelMatrix: modelMatrix,
        vertexShaderSource: vertexSource,
        fragmentShaderSource: fragmentSource,
        renderState: splatRenderState,
        instanceCount: InPointCount,
      });

      GSplatDrawer = {
        orderedSplatIndices: orderedSplatIndices,
      };

      gsPrimitive = CesiumViewer.scene.primitives.add(gaussianSplatPrimitive);
    } catch (err) {
      console.log("SetupCustomSplatDrawer(ERROR)" + err);
      console.log("SetupCustomSplatDrawer(ERROR)" + err.message);
    }

    CesiumViewer.camera.flyTo({
      destination: Cesium.Cartesian3.fromDegrees(120, 30, 1),
      orientation: {
        heading: Cesium.Math.toRadians(30.0),
        pitch: Cesium.Math.toRadians(0),
        roll: 0.0,
      },
    });
  }
}
