import express from 'express'
import { controller } from './controller'

const router = express.Router()

router.get(/memory$/, controller.memory)
router.get(/status$/, controller.status)

export default router