import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js'
import { MTLLoader } from 'three/examples/jsm/loaders/MTLLoader.js'
import './App.css'

function disposeObject(object) {
  if (!object) return

  object.traverse((child) => {
    if (child.isMesh) {
      if (child.geometry) {
        child.geometry.dispose()
      }

      if (child.material) {
        if (Array.isArray(child.material)) {
          child.material.forEach((material) => disposeMaterial(material))
        } else {
          disposeMaterial(child.material)
        }
      }
    }
  })
}

function disposeMaterial(material) {
  if (!material) return

  for (const key in material) {
    const value = material[key]
    if (value && value.isTexture) {
      value.dispose()
    }
  }

  material.dispose?.()
}

function disposeHelper(helper) {
  if (!helper) return
  if (helper.geometry) helper.geometry.dispose()
  if (helper.material) {
    if (Array.isArray(helper.material)) {
      helper.material.forEach((mat) => mat.dispose?.())
    } else {
      helper.material.dispose?.()
    }
  }
}

function countMeshes(object) {
  let meshCount = 0
  object.traverse((child) => {
    if (child.isMesh) meshCount += 1
  })
  return meshCount
}

function fitCameraToObject(camera, controls, object) {
  const box = new THREE.Box3().setFromObject(object)

  if (box.isEmpty()) {
    throw new Error('OBJ loaded, but no renderable geometry was found.')
  }

  const size = box.getSize(new THREE.Vector3())
  const center = box.getCenter(new THREE.Vector3())

  const maxDim = Math.max(size.x, size.y, size.z, 0.001)
  const fov = camera.fov * (Math.PI / 180)
  let cameraZ = Math.abs(maxDim / 2 / Math.tan(fov / 2))
  cameraZ *= 1.8

  camera.position.set(center.x + cameraZ * 0.8, center.y + cameraZ * 0.6, center.z + cameraZ * 0.8)
  const cameraDistance = camera.position.distanceTo(center)
  camera.near = Math.max(cameraDistance / 1000, 0.0001)
  camera.far = Math.max(cameraDistance * 100, 1000)
  camera.updateProjectionMatrix()

  controls.target.copy(center)
  controls.update()

  return { box, size, center }
}

function createTextureMap(files) {
  const textureMap = new Map()

  files.forEach((file) => {
    const lower = file.name.toLowerCase()
    if (
      lower.endsWith('.jpg') ||
      lower.endsWith('.jpeg') ||
      lower.endsWith('.png') ||
      lower.endsWith('.bmp') ||
      lower.endsWith('.gif') ||
      lower.endsWith('.webp')
    ) {
      textureMap.set(file.name, file)
      textureMap.set(file.name.toLowerCase(), file)
    }
  })

  return textureMap
}

async function loadObjWithOptionalMtl(files) {
  const objFile = files.find((file) => file.name.toLowerCase().endsWith('.obj'))
  const mtlFile = files.find((file) => file.name.toLowerCase().endsWith('.mtl'))

  if (!objFile) {
    throw new Error('Please select an OBJ file.')
  }

  const objText = await objFile.text()
  const textureMap = createTextureMap(files)

  const loadingManager = new THREE.LoadingManager()
  const createdObjectUrls = []

  loadingManager.setURLModifier((url) => {
    const normalized = url.split('/').pop()
    const textureFile =
      textureMap.get(url) ||
      textureMap.get(url.toLowerCase()) ||
      textureMap.get(normalized) ||
      textureMap.get(normalized?.toLowerCase())

    if (textureFile) {
      const objectUrl = URL.createObjectURL(textureFile)
      createdObjectUrls.push(objectUrl)
      return objectUrl
    }

    return url
  })

  let materials = null
  let hasMtl = false

  if (mtlFile) {
    const mtlText = await mtlFile.text()
    const mtlLoader = new MTLLoader(loadingManager)
    materials = mtlLoader.parse(mtlText)
    materials.preload()
    hasMtl = true
  }

  const objLoader = new OBJLoader(loadingManager)

  if (materials) {
    objLoader.setMaterials(materials)
  }

  const object = objLoader.parse(objText)

  object.traverse((child) => {
    if (child.isMesh) {
      child.castShadow = true
      child.receiveShadow = true

      if (child.geometry && !child.geometry.attributes.normal) {
        child.geometry.computeVertexNormals()
      }

      if (child.material) {
        if (Array.isArray(child.material)) {
          child.material.forEach((mat) => {
            if (mat) mat.side = THREE.DoubleSide
          })
        } else {
          child.material.side = THREE.DoubleSide
        }
      }
    }
  })

  return {
    object,
    objFile,
    hasMtl,
    textureCount: textureMap.size > 0 ? Math.ceil(textureMap.size / 2) : 0,
    cleanupUrls: () => {
      createdObjectUrls.forEach((url) => URL.revokeObjectURL(url))
    },
  }
}

function App() {
  const mountRef = useRef(null)

  const sceneRef = useRef(null)
  const cameraRef = useRef(null)
  const rendererRef = useRef(null)
  const controlsRef = useRef(null)

  const modelRef = useRef(null)
  const boxHelperRef = useRef(null)
  const animationIdRef = useRef(null)
  const axesHelperRef = useRef(null)
  const gridHelperRef = useRef(null)
  const modelCleanupRef = useRef(null)

  const [statusText, setStatusText] = useState('Ready')
  const [modelInfo, setModelInfo] = useState({
    fileName: '-',
    hasMtl: false,
    textureCount: 0,
    width: 0,
    height: 0,
    depth: 0,
    meshCount: 0,
  })

  useEffect(() => {
    const mountEl = mountRef.current
    if (!mountEl) return

    const scene = new THREE.Scene()
    scene.background = new THREE.Color(0xf5f5f5)
    sceneRef.current = scene

    const camera = new THREE.PerspectiveCamera(
      60,
      mountEl.clientWidth / mountEl.clientHeight,
      0.1,
      2000
    )
    camera.position.set(5, 5, 20)
    camera.lookAt(0, 0, 0)
    cameraRef.current = camera

    const renderer = new THREE.WebGLRenderer({ antialias: true })
    renderer.setSize(mountEl.clientWidth, mountEl.clientHeight)
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.shadowMap.enabled = true
    mountEl.appendChild(renderer.domElement)
    rendererRef.current = renderer

    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true
    controls.target.set(0, 0, 0)
    controls.update()
    controlsRef.current = controls

    const gridHelper = new THREE.GridHelper(20, 20)
    gridHelper.rotation.x = Math.PI / 2
    scene.add(gridHelper)
    gridHelperRef.current = gridHelper

    const axesHelper = new THREE.AxesHelper(5)
    scene.add(axesHelper)
    axesHelperRef.current = axesHelper

    const ambientLight = new THREE.AmbientLight(0xffffff, 0.9)
    scene.add(ambientLight)

    const directionalLight = new THREE.DirectionalLight(0xffffff, 1.2)
    directionalLight.position.set(10, 12, 8)
    directionalLight.castShadow = true
    scene.add(directionalLight)

    const animate = () => {
      controls.update()
      renderer.render(scene, camera)
      animationIdRef.current = requestAnimationFrame(animate)
    }
    animate()

    const handleResize = () => {
      if (!mountRef.current || !cameraRef.current || !rendererRef.current) return

      const width = mountRef.current.clientWidth
      const height = mountRef.current.clientHeight

      cameraRef.current.aspect = width / height
      cameraRef.current.updateProjectionMatrix()
      rendererRef.current.setSize(width, height)
    }

    window.addEventListener('resize', handleResize)

    return () => {
      window.removeEventListener('resize', handleResize)

      if (animationIdRef.current) {
        cancelAnimationFrame(animationIdRef.current)
      }

      if (modelCleanupRef.current) {
        modelCleanupRef.current()
        modelCleanupRef.current = null
      }

      if (modelRef.current) {
        scene.remove(modelRef.current)
        disposeObject(modelRef.current)
        modelRef.current = null
      }

      if (boxHelperRef.current) {
        scene.remove(boxHelperRef.current)
        disposeHelper(boxHelperRef.current)
        boxHelperRef.current = null
      }

      if (axesHelperRef.current) {
        scene.remove(axesHelperRef.current)
      }

      if (gridHelperRef.current) {
        scene.remove(gridHelperRef.current)
      }

      controls.dispose()
      renderer.dispose()

      if (renderer.domElement && mountEl.contains(renderer.domElement)) {
        mountEl.removeChild(renderer.domElement)
      }
    }
  }, [])

  const clearCurrentModel = () => {
    const scene = sceneRef.current
    if (!scene) return

    if (modelCleanupRef.current) {
      modelCleanupRef.current()
      modelCleanupRef.current = null
    }

    if (modelRef.current) {
      scene.remove(modelRef.current)
      disposeObject(modelRef.current)
      modelRef.current = null
    }

    if (boxHelperRef.current) {
      scene.remove(boxHelperRef.current)
      disposeHelper(boxHelperRef.current)
      boxHelperRef.current = null
    }
  }

  const handleFilesChange = async (event) => {
    const files = Array.from(event.target.files || [])
    if (files.length === 0) return

    const scene = sceneRef.current
    const camera = cameraRef.current
    const controls = controlsRef.current

    if (!scene || !camera || !controls) return

    try {
      setStatusText('Loading files...')
      clearCurrentModel()

      const result = await loadObjWithOptionalMtl(files)
      const loadedObject = result.object

      scene.add(loadedObject)
      modelRef.current = loadedObject
      modelCleanupRef.current = result.cleanupUrls

      const boxHelper = new THREE.BoxHelper(loadedObject, 0xff6600)
      scene.add(boxHelper)
      boxHelperRef.current = boxHelper

      const fitResult = fitCameraToObject(camera, controls, loadedObject)
      const meshCount = countMeshes(loadedObject)

      setModelInfo({
        fileName: result.objFile.name,
        hasMtl: result.hasMtl,
        textureCount: result.textureCount,
        width: fitResult.size.x,
        height: fitResult.size.y,
        depth: fitResult.size.z,
        meshCount,
      })

      setStatusText(`Loaded: ${result.objFile.name}`)
    } catch (error) {
      console.error(error)
      setStatusText(error.message || 'Failed to load model.')
    } finally {
      event.target.value = ''
    }
  }

  return (
    <div className="appShell">
      <header className="topBar">
        <div className="titleBlock">
          <h1>OBJ Inspector Demo</h1>
          <p>Upload OBJ + MTL + textures</p>
        </div>
      </header>

      <div className="mainLayout">
        <aside className="sidePanel">
          <section className="panelCard">
            <h2>Upload</h2>
            <label className="uploadButton">
              Select Model Files
              <input
                type="file"
                multiple
                accept=".obj,.mtl,.png,.jpg,.jpeg,.bmp,.gif,.webp"
                onChange={handleFilesChange}
              />
            </label>
            <p className="hintText">
              Select OBJ first, and also include the matching MTL and texture files if the model uses materials.
            </p>
          </section>

          <section className="panelCard">
            <h2>Status</h2>
            <p>{statusText}</p>
          </section>

          <section className="panelCard">
            <h2>Model Info</h2>
            <div className="infoRow">
              <span>File Name</span>
              <span>{modelInfo.fileName}</span>
            </div>
            <div className="infoRow">
              <span>MTL Found</span>
              <span>{modelInfo.hasMtl ? 'Yes' : 'No'}</span>
            </div>
            <div className="infoRow">
              <span>Texture Count</span>
              <span>{modelInfo.textureCount}</span>
            </div>
            <div className="infoRow">
              <span>Mesh Count</span>
              <span>{modelInfo.meshCount}</span>
            </div>
            <div className="infoRow">
              <span>Width</span>
              <span>{modelInfo.width.toFixed(2)}</span>
            </div>
            <div className="infoRow">
              <span>Height</span>
              <span>{modelInfo.height.toFixed(2)}</span>
            </div>
            <div className="infoRow">
              <span>Depth</span>
              <span>{modelInfo.depth.toFixed(2)}</span>
            </div>
          </section>
        </aside>

        <main className="viewerArea">
          <div ref={mountRef} className="viewerCanvas" />
        </main>
      </div>
    </div>
  )
}

export default App