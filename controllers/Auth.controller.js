const Users = require("../models/Users.model");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const { Op } = require("sequelize");
require("dotenv").config();

const loginUser = async (req, res, next) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ message: "Username and password are required" });
    }

    const user = await Users.findOne({ where: { username } });

    if (!user) {
      return res.status(401).json({ message: "Invalid username or password" });
    }

    const isPasswordValid = await bcrypt.compare(password, user.password);

    if (!isPasswordValid) {
      return res.status(401).json({ message: "Invalid username or password" });
    }

    const token = jwt.sign(
      { id: user.id, username: user.username, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: "1d" }
    );

    const { password: _, ...userWithoutPassword } = user.toJSON();

    res.status(200).json({
      message: "Login successful",
      token,
      user: userWithoutPassword,
    });
  } catch (error) {
    next(error);
  }
};

const registerUser = async (req, res, next) => {
  try {
    const { username, password, name, phoneNo, role, linesHandle, pin } = req.body;

    if (!username || !password || !name) {
      return res.status(400).json({ message: "Username, password, and name are required" });
    }

    const existingUser = await Users.findOne({ where: { username } });
    if (existingUser) {
      return res.status(400).json({ message: "Username already exists" });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    // 🔹 Ensure only Admin has PIN
    const finalPin = (role && role.toLowerCase() === 'admin') ? pin : null;

    const newUser = await Users.create({
      username,
      password: hashedPassword,
      name,
      phoneNo,
      role,
      linesHandle,
      pin: finalPin,
    });

    res.status(201).json({
      message: "User registered successfully",
    });
  } catch (error) {
    next(error);
  }
};

const getAllUsersExceptAdmin = async (req, res, next) => {
  try {
    const users = await Users.findAll({
      where: {
        role: {
          [Op.notILike]: 'admin' // Case-insensitive exclusion
        }
      },
      attributes: { exclude: ["password"] },
      order: [['username', 'ASC']]
    });
    res.status(200).json(users);
  } catch (error) {
    next(error);
  }
};

const getSingleUser = async (req, res, next) => {
  try {
    const { id } = req.query;

    if (!id) {
      return res.status(400).json({ message: "User ID is required" });
    }

    const user = await Users.findByPk(id, {
      attributes: { exclude: ["password"] }
    });

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    res.status(200).json(user);
  } catch (error) {
    next(error);
  }
};

const updateUser = async (req, res, next) => {
  try {
    const { id } = req.query;
    const { name, phoneNo, role, linesHandle, password, pin } = req.body;

    if (!id) {
      return res.status(400).json({ message: "User ID is required" });
    }

    const user = await Users.findByPk(id);

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }
    console.log(pin);
    // Prepare update object (RESTRICTED FIELDS)
    const updateData = {};
    if (name) updateData.name = name;
    if (phoneNo) updateData.phoneNo = phoneNo;
    if (role) updateData.role = role;
    if (linesHandle) updateData.linesHandle = linesHandle;

    // 🔹 Ensure only Admin can have/update PIN
    // if (user.role && user.role.toLowerCase() === 'admin' && pin !== undefined) {
    //   updateData.pin = pin;
    // } else if (pin !== undefined) {
    //   // If a non-admin is being updated and a pin is provided, explicitly set it to null or ignore it
    //   updateData.pin = null;
    // }

    // Update password only if provided
    if (password) {
      const hashedPassword = await bcrypt.hash(password, 10);
      updateData.password = hashedPassword;
    }

    await user.update(updateData);

    res.status(200).json({
      message: "User updated successfully",
    });
  } catch (error) {
    next(error);
  }
};

const deleteUser = async (req, res, next) => {
  try {
    const { id } = req.query;

    if (!id) {
      return res.status(400).json({ message: "User ID is required" });
    }

    const user = await Users.findByPk(id);

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    await user.destroy();

    res.status(200).json({
      message: "User deleted successfully"
    });
  } catch (error) {
    next(error);
  }
};

const addAreaToUser = async (req, res, next) => {
  try {
    let { areaName } = req.body;

    // ✅ Validation
    if (!areaName) {
      return res.status(400).json({ message: "Area Name is required" });
    }

    // ✅ Normalize area name (trim + lowercase)
    areaName = areaName.trim().toLowerCase();

    const usersAll = await Users.findAll({
      where: { role: "Admin" }
    });

    if (!usersAll || usersAll.length === 0) {
      return res.status(404).json({ message: "No Admin users found" });
    }

    for (const user of usersAll) {
      // ✅ Ensure existing array & normalize it too
      const existingLinesHandle = Array.isArray(user.linesHandle)
        ? user.linesHandle.map(a => a.toLowerCase())
        : [];

      // ✅ Skip if already exists
      if (existingLinesHandle.includes(areaName)) continue;

      // ✅ Add lowercase area
      const updatedLinesHandle = [...existingLinesHandle, areaName];

      await user.update({ linesHandle: updatedLinesHandle });
    }

    res.status(200).json({
      message: `Area '${areaName}' added successfully to all Admin users`
    });

  } catch (error) {
    next(error);
  }
};

const editArea = async (req, res, next) => {
  try {
    let { oldAreaName, newAreaName } = req.body;

    if (!oldAreaName || !newAreaName) {
      return res.status(400).json({ message: "oldAreaName and newAreaName are required" });
    }

    oldAreaName = oldAreaName.trim().toLowerCase();
    newAreaName = newAreaName.trim().toLowerCase();

    const allUsers = await Users.findAll();

    for (const user of allUsers) {
      if (user.linesHandle && Array.isArray(user.linesHandle)) {
        const lowerLinesHandle = user.linesHandle.map(a => typeof a === 'string' ? a.toLowerCase() : String(a).toLowerCase());
        const areaIndex = lowerLinesHandle.indexOf(oldAreaName);
        if (areaIndex !== -1) {
          lowerLinesHandle[areaIndex] = newAreaName;
          const updatedLinesHandle = [...new Set(lowerLinesHandle)];
          await user.update({ linesHandle: updatedLinesHandle });
        }
      }
    }

    res.status(200).json({
      success: true,
      message: `Area '${oldAreaName}' updated to '${newAreaName}' successfully`
    });

  } catch (error) {
    next(error);
  }
};

const deleteArea = async (req, res, next) => {
  try {
    let { areaName } = req.query;
    if (!areaName) {
      areaName = req.body.areaName;
    }

    if (!areaName) {
      return res.status(400).json({ message: "areaName is required" });
    }

    areaName = areaName.trim().toLowerCase();

    const allUsers = await Users.findAll();

    for (const user of allUsers) {
      if (user.linesHandle && Array.isArray(user.linesHandle)) {
        const lowerLinesHandle = user.linesHandle.map(a => typeof a === 'string' ? a.toLowerCase() : String(a).toLowerCase());
        const filteredLinesHandle = lowerLinesHandle.filter(a => a !== areaName);
        
        if (lowerLinesHandle.length !== filteredLinesHandle.length) {
          await user.update({ linesHandle: filteredLinesHandle });
        }
      }
    }

    res.status(200).json({
      success: true,
      message: `Area '${areaName}' deleted successfully`
    });

  } catch (error) {
    next(error);
  }
};

const getAllAreas = async (req, res, next) => {
  try {
    const allUsers = await Users.findAll();
    const allAreas = new Set();

    allUsers.forEach(user => {
      if (user.linesHandle && Array.isArray(user.linesHandle)) {
        user.linesHandle.forEach(area => {
           if (area) {
             allAreas.add(typeof area === 'string' ? area.toLowerCase() : String(area).toLowerCase());
           }
        });
      }
    });

    res.status(200).json({
      success: true,
      data: Array.from(allAreas)
    });

  } catch (error) {
    next(error);
  }
};

const updatePasswordByUsername = async (req, res, next) => {
  try {
    const { username, newPassword, pin } = req.body;

    if (!username || !newPassword || !pin) {
      return res.status(400).json({
        success: false,
        message: "username, newPassword, and pin are required",
      });
    }

    // 🔹 Find user by username
    const user = await Users.findOne({
      where: { username },
    });

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    // 🔹 Validate PIN (Only for Admins, or anyone who has a PIN)
    // Requirement: "only the admin has the pin"
    // So if user has a PIN, we validate it. If they don't (Subadmin), 
    // maybe we shouldn't allow this method? 
    // User said "validate the pin in resetpassword".

    if (user.pin !== pin) {
      return res.status(401).json({
        success: false,
        message: "Invalid PIN. Password update denied.",
      });
    }

    // 🔹 Hash new password
    const hashedPassword = await bcrypt.hash(newPassword, 10);

    // 🔹 Update password
    await Users.update(
      { password: hashedPassword },
      { where: { username } }
    );

    res.status(200).json({
      success: true,
      message: "Password updated successfully",
    });
  } catch (error) {
    next(error);
  }
};

const updatePin = async (req, res, next) => {
  try {
    const { username, oldPin, newPin } = req.body;

    if (!username || !oldPin || !newPin) {
      return res.status(400).json({
        success: false,
        message: "Username, oldPin, and newPin are required",
      });
    }

    const user = await Users.findOne({ where: { username } });
    if (!user) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    // 🔹 Check if user is allowed to have a PIN (Admin)
    // or just check if they currently have one logic check

    if (user.pin !== oldPin) {
      return res.status(401).json({
        success: false,
        message: "Old PIN is incorrect",
      });
    }

    // 🔹 Update to new PIN
    await user.update({ pin: newPin });

    res.status(200).json({
      success: true,
      message: "PIN updated successfully",
    });
  } catch (error) {
    next(error);
  }
};

const validatePin = async (req, res, next) => {
  try {
    const { username, pin } = req.body;

    if (!username || !pin) {
      return res.status(400).json({
        success: false,
        message: "Username and PIN are required",
      });
    }

    // 🔹 Verify if user exists
    const user = await Users.findOne({ where: { username } });
    if (!user) {
      return res.status(404).json({
        success: false,
        message: "enter the correct username",
      });
    }

    // 🔹 Validate PIN
    if (user.pin !== pin) {
      return res.status(401).json({
        success: false,
        message: "Verification failed: Incorrect PIN",
      });
    }

    res.status(200).json({
      success: true,
      message: "Verification successful",
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  loginUser,
  registerUser,
  getAllUsersExceptAdmin,
  getSingleUser,
  updateUser,
  deleteUser,
  addAreaToUser,
  editArea,
  deleteArea,
  getAllAreas,
  updatePasswordByUsername,
  validatePin,
  updatePin,
};

