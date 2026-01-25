const express = require('express')
const userRouter = express.Router()
const authMiddleware = require('../middlewares/auth.middleware')
const { loginUser, registerUser, getAllUsersExceptAdmin, getSingleUser, updateUser, deleteUser, addAreaToUser, updatePasswordByUsername, validatePin, updatePin } = require('../controllers/Auth.controller')


//get emthods 
userRouter.get('/all-users', authMiddleware, getAllUsersExceptAdmin)
userRouter.get('/userById', authMiddleware, getSingleUser)

// //post methods 
userRouter.post('/login', loginUser)
userRouter.post('/new-user', registerUser)
userRouter.post('/update-user', authMiddleware, updateUser)
userRouter.post('/add-area', authMiddleware, addAreaToUser)
userRouter.post('/update-password', updatePasswordByUsername)
userRouter.post('/update-pin', updatePin)
userRouter.post('/validate-pin', validatePin)
// //delete methods 
userRouter.delete('/delete-user', authMiddleware, deleteUser)

module.exports = userRouter