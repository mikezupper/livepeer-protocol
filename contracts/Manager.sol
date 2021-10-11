// SPDX-FileCopyrightText: 2021 Livepeer <info@livepeer.org>
// SPDX-License-Identifier: MIT

pragma solidity 0.8.4;

import "./IManager.sol";
import "./IController.sol";

contract Manager is IManager {
    // Controller that contract is registered with
    IController public controller;

    // Check if sender is controller
    modifier onlyController() {
        _onlyController();
        _;
    }

    // Check if sender is controller owner
    modifier onlyControllerOwner() {
        _onlyControllerOwner();
        _;
    }

    // Check if controller is not paused
    modifier whenSystemNotPaused() {
        _whenSystemNotPaused();
        _;
    }

    // Check if controller is paused
    modifier whenSystemPaused() {
        _whenSystemPaused();
        _;
    }

    constructor(address _controller) {
        controller = IController(_controller);
    }

    /**
     * @notice Set controller. Only callable by current controller
     * @param _controller Controller contract address
     */
    function setController(address _controller) external override onlyController {
        controller = IController(_controller);

        emit SetController(_controller);
    }

    function _onlyController() internal view {
        require(msg.sender == address(controller), "ONLY_CONTROLLER");
    }

    function _onlyControllerOwner() internal view {
        require(msg.sender == controller.owner(), "ONLY_CONTROLLER_OWNER");
    }

    function _whenSystemNotPaused() internal view {
        require(!controller.paused(), "SYSTEM_PAUSED");
    }

    function _whenSystemPaused() internal view {
        require(controller.paused(), "SYSTEM_NOT_PAUSED");
    }
}
