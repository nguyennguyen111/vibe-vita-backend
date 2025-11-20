const express = require('express')
const router = express.Router()
const jwt = require('jsonwebtoken')
const multer = require('multer') //////////////
const path = require('path')
const fs = require('fs')

const User = require('../models/User')
const { authenticate, authorize } = require('../middleware/auth')

// ==========================
// 🧩 Cấu hình lưu ảnh bằng multer
// ==========================
const avatarStorage = multer.diskStorage({
  destination: function (req, file, cb) {
    const uploadPath = path.join(__dirname, '../uploads/avatars')
    if (!fs.existsSync(uploadPath)) {
      fs.mkdirSync(uploadPath, { recursive: true })
    }
    cb(null, uploadPath)
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9)
    cb(null, uniqueSuffix + path.extname(file.originalname))
  }
})

const uploadAvatar = multer({
  storage: avatarStorage,
  limits: { fileSize: 5 * 1024 * 1024 }, // giới hạn 5MB
  fileFilter: (req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'image/webp']
    if (!allowed.includes(file.mimetype)) {
      return cb(new Error('Chỉ chấp nhận file JPG, PNG hoặc WEBP'))
    }
    cb(null, true)
  }
})

// -------------------------------
// 🧩 ĐĂNG KÝ
// -------------------------------
router.post('/register', async (req, res) => {
  try {
    const { username, email, password, phone, dateOfBirth, role } = req.body

    // Kiểm tra user đã tồn tại
    const existingUser = await User.findOne({
      $or: [{ email }, { username }, ...(phone ? [{ phone }] : [])]
    })

    if (existingUser) {
      return res.status(400).json({
        message: 'Username, email hoặc số điện thoại đã tồn tại'
      })
    }

    // Tạo user mới
    const userData = {
      username,
      email,
      password,
      role: role || 'user'
    }

    if (phone) userData.phone = phone
    if (dateOfBirth) userData.dateOfBirth = dateOfBirth

    const user = new User(userData)
    await user.save()

    // Tạo token
    const token = jwt.sign(
      { id: user._id, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    )

    res.status(201).json({
      message: 'Đăng ký thành công',
      user: {
        id: user._id,
        username: user.username,
        email: user.email,
        phone: user.phone,
        dateOfBirth: user.dateOfBirth,
        role: user.role
      }
    })
  } catch (error) {
    res.status(500).json({ message: 'Lỗi server', error: error.message })
  }
})

// -------------------------------
// 🧩 ĐĂNG NHẬP
// -------------------------------
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body

    const user = await User.findOne({ email })
    if (!user) {
      return res.status(401).json({ message: 'Email hoặc password không đúng' })
    }

    const isMatch = await user.comparePassword(password)
    if (!isMatch) {
      return res.status(401).json({ message: 'Email hoặc password không đúng' })
    }

    const token = jwt.sign(
      { id: user._id, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    )

    res.json({
      message: 'Đăng nhập thành công',
      token,
      user: {
        id: user._id,
        username: user.username,
        email: user.email,
        phone: user.phone,
        dateOfBirth: user.dateOfBirth,
        role: user.role
      }
    })
  } catch (error) {
    res.status(500).json({ message: 'Lỗi server', error: error.message })
  }
})

// -------------------------------
// 🧩 LẤY THÔNG TIN USER HIỆN TẠI
// -------------------------------
router.get('/me', authenticate, async (req, res) => {
  res.json({ user: req.user })
})

// -------------------------------
// 🧩 ROUTE CHO ADMIN
// -------------------------------
router.get('/admin', authenticate, authorize('admin'), async (req, res) => {
  res.json({ message: 'Đây là route dành cho admin' })
})

// -------------------------------
// 🧩 LẤY DANH SÁCH TRAINERS
// -------------------------------
router.get('/trainers', async (req, res) => {
  try {
    const trainers = await User.find({ role: 'pt' }).select('-password')
    res.json(trainers)
  } catch (error) {
    res.status(500).json({ message: 'Lỗi server', error: error.message })
  }
})

// -------------------------------
// 🧩 ROUTE CHO PT + ADMIN
// -------------------------------
router.get('/pt', authenticate, authorize('pt', 'admin'), async (req, res) => {
  res.json({ message: 'Đây là route dành cho PT và admin' })
})

// -------------------------------
// 🧩 CẬP NHẬT PROFILE USER
// -------------------------------
router.put('/profile', authenticate, async (req, res) => {
  try {
    const { username, email, phone, dateOfBirth, gender, height, weight } =
      req.body
    const userId = req.user._id
    const HealthInfo = require('../models/HealthInfo')

    // ✅ Cập nhật thông tin user
    const updateUserData = {}
    if (username) updateUserData.username = username
    if (email) updateUserData.email = email
    if (phone) updateUserData.phone = phone
    if (dateOfBirth) updateUserData.dateOfBirth = dateOfBirth

    // ✅ Kiểm tra trùng lặp email/username/phone
    if (email || username || phone) {
      const existingUser = await User.findOne({
        _id: { $ne: userId },
        $or: [
          ...(email ? [{ email }] : []),
          ...(username ? [{ username }] : []),
          ...(phone ? [{ phone }] : [])
        ]
      })

      if (existingUser) {
        return res.status(400).json({
          message: 'Email, username hoặc số điện thoại đã tồn tại'
        })
      }
    }

    const updatedUser = await User.findByIdAndUpdate(userId, updateUserData, {
      new: true,
      runValidators: true
    }).select('-password')

    // ✅ Xử lý health info
    let healthInfo = null
    if (gender || height || weight) {
      healthInfo = await HealthInfo.findOne({ userId })

      if (healthInfo) {
        if (gender) healthInfo.gender = gender
        if (height) healthInfo.height = height
        if (weight) healthInfo.weight = weight
        await healthInfo.save()
      } else {
        healthInfo = new HealthInfo({
          userId,
          gender: gender || 'male',
          height: height || 170,
          weight: weight || 70
        })
        await healthInfo.save()
      }
    }

    // ✅ Nếu không cập nhật healthInfo, giữ nguyên giá trị cũ
    const existingHealth = await HealthInfo.findOne({ userId })

    res.json({
      message: 'Cập nhật profile thành công',
      data: {
        user: updatedUser,
        healthInfo: healthInfo
          ? {
              id: healthInfo._id,
              gender: healthInfo.gender,
              height: healthInfo.height,
              weight: healthInfo.weight,
              bmi: healthInfo.bmi,
              bmiCategory: healthInfo.bmiCategory
            }
          : existingHealth
          ? {
              id: existingHealth._id,
              gender: existingHealth.gender,
              height: existingHealth.height,
              weight: existingHealth.weight,
              bmi: existingHealth.bmi,
              bmiCategory: existingHealth.bmiCategory
            }
          : null
      }
    })
  } catch (error) {
    console.error('Update profile error:', error)
    res.status(500).json({
      message: 'Lỗi server',
      error: error.message
    })
  }
})

// -------------------------------
// 🧩 CẬP NHẬT PROFILE TRAINER (có username, email, prices)
// -------------------------------
router.put(
  '/trainer/profile',
  authenticate,
  authorize('pt', 'admin'),
  async (req, res) => {
    try {
      const {
        username,
        email,
        specialty,
        experience,
        location,
        description,
        prices
      } = req.body
      const userId = req.user._id

      const updateData = {}
      if (username) updateData.username = username
      if (email) updateData.email = email
      if (specialty) updateData.specialty = specialty
      if (experience) updateData.experience = experience
      if (location) updateData.location = location
      if (description) updateData.description = description
      if (prices) updateData.prices = prices

      // ✅ Kiểm tra trùng tên/email với người khác
      if (email || username) {
        const existingUser = await User.findOne({
          _id: { $ne: userId },
          $or: [
            ...(email ? [{ email }] : []),
            ...(username ? [{ username }] : [])
          ]
        })
        if (existingUser) {
          return res.status(400).json({
            message: 'Email hoặc username đã tồn tại, vui lòng chọn tên khác!'
          })
        }
      }

      const updatedTrainer = await User.findByIdAndUpdate(userId, updateData, {
        new: true,
        runValidators: true
      }).select('-password')

      res.json({
        message: '✅ Cập nhật profile PT thành công!',
        updated: updatedTrainer
      })
    } catch (error) {
      console.error('Update trainer profile error:', error)
      res.status(500).json({ message: 'Lỗi server', error: error.message })
    }
  }
)

// -------------------------------
// ✅ UPLOAD ẢNH ĐẠI DIỆN
// -------------------------------
router.post(
  '/upload-avatar',
  authenticate,
  uploadAvatar.single('avatar'),
  async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ message: 'Không có file được tải lên!' })
      }

      const userId = req.user._id
      const imagePath = `/uploads/avatars/${req.file.filename}`

      const updatedUser = await User.findByIdAndUpdate(
        userId,
        { image: imagePath },
        { new: true }
      ).select('-password')

      res.json({
        message: 'Ảnh đại diện đã được cập nhật thành công!',
        user: updatedUser
      })
    } catch (error) {
      console.error('Upload avatar error:', error)
      res.status(500).json({
        message: 'Lỗi khi tải ảnh đại diện!',
        error: error.message
      })
    }
  }
)

// -------------------------------
// ✅ LẤY PROFILE USER/PT ĐẦY ĐỦ
// -------------------------------
router.get('/profile/me', authenticate, async (req, res) => {
  try {
    const userId = req.user._id
    const HealthInfo = require('../models/HealthInfo')

    const user = await User.findById(userId).select('-password')
    if (!user) {
      return res.status(404).json({ message: 'Không tìm thấy user' })
    }

    const healthInfo = await HealthInfo.findOne({ userId })

    res.json({
      message: 'Lấy thông tin profile thành công',
      data: {
        user: {
          id: user._id,
          username: user.username,
          email: user.email,
          phone: user.phone,
          dateOfBirth: user.dateOfBirth,
          role: user.role,
          isPremium: user.isPremium,
          premiumExpiredAt: user.premiumExpiredAt,
          premiumDaysLeft: user.premiumDaysLeft,
          image: user.image,
          specialty: user.specialty,
          experience: user.experience,
          location: user.location,
          description: user.description,
          prices: user.prices
        },
        healthInfo: healthInfo
          ? {
              gender: healthInfo.gender,
              height: healthInfo.height,
              weight: healthInfo.weight,
              bmi: healthInfo.bmi,
              bmiCategory: healthInfo.bmiCategory
            }
          : null
      }
    })
  } catch (error) {
    console.error('❌ Lỗi lấy profile:', error)
    res.status(500).json({ message: 'Lỗi server', error: error.message })
  }
})
// -------------------------------
// 🧩 LẤY CHI TIẾT MỘT TRAINER
// -------------------------------
router.get('/trainers/:id', async (req, res) => {
  try {
    const { id } = req.params
    const trainer = await User.findById(id).select('-password').lean()

    if (!trainer || trainer.role !== 'pt') {
      return res.status(404).json({ message: 'Không tìm thấy trainer!' })
    }

    res.json(trainer)
  } catch (error) {
    console.error('❌ Lỗi lấy trainer:', error)
    res.status(500).json({ message: 'Lỗi server', error: error.message })
  }
})
// ✅ LẤY CHI TIẾT 1 TRAINER THEO ID
router.get('/trainers/:id', async (req, res) => {
  try {
    const trainer = await User.findById(req.params.id).select('-password')
    if (!trainer || trainer.role !== 'pt') {
      return res.status(404).json({ message: 'Không tìm thấy trainer' })
    }
    res.json(trainer)
  } catch (err) {
    res.status(500).json({ message: 'Lỗi server', error: err.message })
  }
})
module.exports = router
